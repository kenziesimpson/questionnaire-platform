import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MASKING_CASES, SECRETS, SESSION_ROUTE_PATHS, type MaskingCase } from "../e2e/fixtures/nginx/masking-cases";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const nginxConfig = readFileSync(resolve(repoRoot, "deploy/frontend/nginx.conf"), "utf8");

const LOGGED_VARIABLES = ["request_method", "logged_route", "logged_status", "logged_trace_id", "logged_span_id"];

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

interface MapRule {
  readonly pattern: RegExp | undefined;
  readonly value: string;
}

type Variables = Readonly<Record<string, string>>;

const RULE_LINE = /^\s*(?:"~(.+?)"|"([^"~][^"]*)"|default)\s+(?:"(.*)"|(\S+));$/;

function escapedForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapRules(source: string, target: string): MapRule[] {
  const header = `map ${source} ${target} {`;
  const start = nginxConfig.indexOf(header);
  if (start === -1) throw new Error(`nginx.conf has no "${header}" block`);
  const end = nginxConfig.indexOf("\n}", start);
  return nginxConfig
    .slice(start + header.length, end)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = RULE_LINE.exec(line);
      if (match === null) throw new Error(`cannot read the map line: ${line}`);
      const source = match[1] ?? (match[2] === undefined ? undefined : `^${escapedForRegExp(match[2])}$`);
      return { pattern: source === undefined ? undefined : new RegExp(source), value: match[3] ?? match[4] ?? "" };
    });
}

function interpolated(value: string, variables: Variables): string {
  return value.replace(/\$\{(\w+)\}|\$(\w+)/g, (_reference, braced: string | undefined, bare: string | undefined) => variables[braced ?? bare ?? ""] ?? "");
}

function applyMap(rules: readonly MapRule[], input: string, variables: Variables = {}): string {
  for (const rule of rules) {
    if (rule.pattern === undefined) continue;
    const match = rule.pattern.exec(input);
    if (match !== null) return interpolated(rule.value, { ...variables, ...match.groups });
  }
  const fallback = rules.find((rule) => rule.pattern === undefined);
  return fallback === undefined ? "" : interpolated(fallback.value, variables);
}

const pathRules = mapRules("$request_uri", "$request_path");
const maskRules = mapRules("$request_path", "$masked_route");
const routeRules = mapRules("$masked_route", "$logged_route");
const statusRules = mapRules("$status", "$logged_status");
const traceRules = mapRules("$http_traceparent", "$logged_trace_id");
const spanRules = mapRules("$http_traceparent", "$logged_span_id");

function loggedRoute(requestUri: string): string {
  const requestPath = applyMap(pathRules, requestUri);
  const maskedRoute = applyMap(maskRules, requestPath, { request_path: requestPath });
  return applyMap(routeRules, maskedRoute, { masked_route: maskedRoute });
}

const ABSOLUTE_FORM_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?]*/;

function requestUriOf(target: string): string {
  const authority = ABSOLUTE_FORM_AUTHORITY.exec(target);
  return authority === null ? target : target.slice(authority[0].length) || "/";
}

describe("the nginx access log names only what it may carry", () => {
  const logFormat = /log_format telemetry escape=json([^;]+);/.exec(nginxConfig)?.[1] ?? "";

  it("is a JSON line", () => {
    expect(logFormat).toContain(`'{"msg":"request completed",'`);
    expect(logFormat.trim().endsWith(`}'`)).toBe(true);
  });

  it("reads exactly the masked route, the parsed trace context, the method and the status", () => {
    const variables = [...logFormat.matchAll(/\$(\w+)/g)].map((match) => match[1]);
    expect(variables).toEqual(LOGGED_VARIABLES);
  });

  it("is the only access log the server writes", () => {
    expect(nginxConfig.match(/access_log /g)).toHaveLength(1);
    expect(nginxConfig).toContain("access_log /var/log/nginx/access.log telemetry;");
  });
});

describe("the route the nginx access log carries", () => {
  it("finds the routes that carry a session id", () => {
    expect(SESSION_ROUTE_PATHS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(MASKING_CASES.map((testCase): [string, MaskingCase] => [testCase.name, testCase]))("logs the tabled route for %s", (_name, testCase) => {
    const route = loggedRoute(requestUriOf(testCase.target));
    expect(route).toBe(testCase.route);
    for (const secret of SECRETS) expect(route.toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it.each([
    ["000", "0"],
    ["200", "200"],
    ["404", "404"],
    ["499", "499"],
  ])("logs the status %s as the JSON number %s", (status, expected) => {
    expect(applyMap(statusRules, status, { status })).toBe(expected);
  });
});

describe("the trace context the nginx access log carries", () => {
  const traceparent = (traceId: string, spanId: string, version = "00"): string => `${version}-${traceId}-${spanId}-01`;

  it("reads the trace and span id of a valid traceparent", () => {
    expect(applyMap(traceRules, traceparent(TRACE_ID, SPAN_ID))).toBe(TRACE_ID);
    expect(applyMap(spanRules, traceparent(TRACE_ID, SPAN_ID))).toBe(SPAN_ID);
  });

  it.each([
    ["no header", ""],
    ["an all-zero trace id", traceparent("0".repeat(32), SPAN_ID)],
    ["an all-zero span id", traceparent(TRACE_ID, "0".repeat(16))],
    ["another version", traceparent(TRACE_ID, SPAN_ID, "01")],
    ["upper-case hex", traceparent(TRACE_ID.toUpperCase(), SPAN_ID)],
    ["a short trace id", traceparent(TRACE_ID.slice(1), SPAN_ID)],
    ["trailing text", `${traceparent(TRACE_ID, SPAN_ID)}, an answer`],
    ["free text", "an answer"],
  ])("logs no trace or span id for %s", (_name, header) => {
    expect(applyMap(traceRules, header)).toBe("");
    expect(applyMap(spanRules, header)).toBe("");
  });
});
