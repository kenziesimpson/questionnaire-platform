import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "../../fixtures/index";
import {
  accessLinesOf,
  frontendContainerId,
  frontendOutput,
  nginxConfigTest,
  type AccessLine,
  type FrontendOutput,
  type ParsedAccessLines,
} from "../../fixtures/nginx/frontend-log";
import { MASKING_CASES, SECRETS, type MaskingCase } from "../../fixtures/nginx/masking-cases";
import { sendRawRequest } from "../../fixtures/nginx/raw-http";

const REQUEST_HOST = "localhost";
const LOG_POLL_INTERVAL_MS = 250;
const LOG_WAIT_MS = 30_000;
const REJECTED_REQUEST_LINE_STATUS = 400;

interface SentRequest {
  readonly testCase: MaskingCase;
  readonly traceId: string;
  readonly spanId: string;
  readonly status: number;
}

interface Observation {
  readonly output: FrontendOutput;
  readonly everyLine: ParsedAccessLines;
  readonly freshLines: readonly AccessLine[];
}

async function send(baseUrl: string, testCase: MaskingCase): Promise<SentRequest> {
  const traceId = randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  const headers = testCase.headersRead ? [`traceparent: 00-${traceId}-${spanId}-01`] : [];
  const status = await sendRawRequest({ baseUrl, target: testCase.target, host: REQUEST_HOST, headers });
  return { testCase, traceId, spanId, status };
}

function isRejectedBeforeItsHeaders(line: AccessLine): boolean {
  return (
    line["http.request.method"] === "" && line.trace_id === "" && line["http.response.status_code"] === REJECTED_REQUEST_LINE_STATUS
  );
}

function linesFor(sent: SentRequest, lines: readonly AccessLine[]): AccessLine[] {
  return sent.testCase.headersRead ? lines.filter((line) => line.trace_id === sent.traceId) : lines.filter(isRejectedBeforeItsHeaders);
}

function everyRequestIsLogged(sent: readonly SentRequest[], lines: readonly AccessLine[]): boolean {
  return sent.every((request) => linesFor(request, lines).length > 0);
}

async function observe(containerId: string, baseline: number, sent: readonly SentRequest[]): Promise<Observation> {
  const deadline = Date.now() + LOG_WAIT_MS;
  for (;;) {
    const output = await frontendOutput(containerId);
    const freshLines = accessLinesOf(output.stdoutLines.slice(baseline)).lines;
    if (everyRequestIsLogged(sent, freshLines) || Date.now() > deadline) {
      return { output, everyLine: accessLinesOf(output.stdoutLines), freshLines };
    }
    await delay(LOG_POLL_INTERVAL_MS);
  }
}

function loggedRoute(sent: SentRequest, lines: readonly AccessLine[]): string {
  const matches = linesFor(sent, lines);
  if (sent.testCase.headersRead && matches.length !== 1) return `<${matches.length} log lines>`;
  if (matches.length === 0) return "<0 log lines>";
  return [...new Set(matches.map((line) => line["http.route"]))].join(" | ");
}

function disagreements(sent: SentRequest, lines: readonly AccessLine[]): string[] {
  const found: string[] = [];
  if (!sent.testCase.headersRead) {
    if (sent.status !== REJECTED_REQUEST_LINE_STATUS) found.push(`${sent.testCase.name}: the client saw ${sent.status}, not ${REJECTED_REQUEST_LINE_STATUS}`);
    return found;
  }
  const [line] = linesFor(sent, lines);
  if (line === undefined) return found;
  if (line["http.response.status_code"] !== sent.status) {
    found.push(`${sent.testCase.name}: the client saw ${sent.status}, the log says ${line["http.response.status_code"]}`);
  }
  if (line.span_id !== sent.spanId) found.push(`${sent.testCase.name}: the log has span id "${line.span_id}", not the one sent`);
  return found;
}

test.describe("E32 — the nginx access log, against the real nginx", () => {
  test("nginx started with the committed config and answers", async ({ stack }) => {
    const containerId = await frontendContainerId(stack.baseUrl);

    expect(await nginxConfigTest(containerId)).toContain("test is successful");
    expect(await sendRawRequest({ baseUrl: stack.baseUrl, target: "/", host: REQUEST_HOST })).toBe(200);
  });

  test("every request target logs the route the shared table expects, and no session id, cursor or query value reaches the container's output", async ({
    stack,
  }) => {
    test.setTimeout(90_000);
    const containerId = await frontendContainerId(stack.baseUrl);
    const baseline = (await frontendOutput(containerId)).stdoutLines.length;

    const sent = await Promise.all(MASKING_CASES.map((testCase) => send(stack.baseUrl, testCase)));
    const { output, everyLine, freshLines } = await observe(containerId, baseline, sent);

    expect(sent.map((request) => ({ name: request.testCase.name, route: loggedRoute(request, freshLines) }))).toEqual(
      MASKING_CASES.map(({ name, route }) => ({ name, route })),
    );
    expect(sent.flatMap((request) => disagreements(request, freshLines))).toEqual([]);
    expect(everyLine.invalid).toEqual([]);

    const haystack = output.all.toLowerCase();
    expect(SECRETS.filter((secret) => haystack.includes(secret.toLowerCase()))).toEqual([]);
  });
});
