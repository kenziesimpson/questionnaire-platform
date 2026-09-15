import type { Page, Request, Response } from "@playwright/test";
import { executionApi, ProblemDetails, problemSlug, type ProblemDetailsWire, type ProblemSlug } from "@qp/shared";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const SESSIONS_PATH = `${executionApi.EXECUTION_PREFIX}/sessions`;
const SUBMIT_PATH = new RegExp(`^${SESSIONS_PATH}/[^/]+/submit$`);

export const SUBMIT_URL_GLOB = `**${SESSIONS_PATH}/*/submit`;

export const SubmitBody = executionApi.submitSession.schema.body;
export type SubmitBody = Static<typeof SubmitBody>;

export const SubmitReceiptBody = executionApi.submitSession.schema.response[200];
export type SubmitReceiptBody = Static<typeof SubmitReceiptBody>;

function pathnameOf(url: string): string {
  return new URL(url).pathname;
}

export function isSubmitRequest(request: Request): boolean {
  return request.method() === "POST" && SUBMIT_PATH.test(pathnameOf(request.url()));
}

export function isCreateSessionRequest(request: Request): boolean {
  return request.method() === "POST" && pathnameOf(request.url()) === SESSIONS_PATH;
}

export function isGetSessionRequest(request: Request, sessionId: string): boolean {
  return request.method() === "GET" && pathnameOf(request.url()) === `${SESSIONS_PATH}/${sessionId}`;
}

export function recordRequests(page: Page, matches: (request: Request) => boolean): Request[] {
  const recorded: Request[] = [];
  page.on("request", (request) => {
    if (matches(request)) recorded.push(request);
  });
  return recorded;
}

export function recordSubmitRequests(page: Page): Request[] {
  return recordRequests(page, isSubmitRequest);
}

export function waitForSubmitResponse(page: Page): Promise<Response> {
  return page.waitForResponse((response) => isSubmitRequest(response.request()));
}

function parsedJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function submitBodyOf(request: Request): SubmitBody {
  const body = parsedJson(request.postData());
  if (!Value.Check(SubmitBody, body)) throw new Error(`The submit request carried a body outside its contract: ${request.postData()}`);
  return body;
}

export async function receiptBodyOf(response: Response): Promise<SubmitReceiptBody> {
  const body = parsedJson(await response.text());
  if (!Value.Check(SubmitReceiptBody, body)) throw new Error(`The submit response carried a body outside its contract: ${JSON.stringify(body)}`);
  return body;
}

export interface ProblemReply {
  readonly raw: string;
  readonly problem: ProblemDetailsWire;
  readonly slug: ProblemSlug | undefined;
}

export async function problemReplyOf(response: Response): Promise<ProblemReply> {
  const raw = await response.text();
  const problem = parsedJson(raw);
  if (!Value.Check(ProblemDetails, problem)) throw new Error(`Expected a problem details body, got ${raw}`);
  return { raw, problem, slug: problemSlug(problem.type) };
}
