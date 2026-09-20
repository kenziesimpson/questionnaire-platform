import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { definitionApi, executionApi, reportingApi, routePath, telemetryApi } from "@qp/shared";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const nginxConfig = readFileSync(resolve(repoRoot, "deploy/frontend/nginx.conf"), "utf8");

const LOGGED_VARIABLES = ["request_method", "logged_route", "logged_status", "logged_trace_id", "logged_span_id"];

const UNMATCHED = ":unmatched";

const SESSION_ID = "7f3c2a10-5b1e-4c7d-9a2e-0d6b8e4f1a35";
const QUESTIONNAIRE_ID = "0b9e4c21-3d5a-4f6b-8c7d-1e2f3a4b5c6d";
const CURSOR = "Zm9yd2FyZHwyMDI2LTA5LTE5fDdmM2MyYTEwLTViMWUtNGM3ZC05YTJlLTBkNmI4ZTRmMWEzNQ";

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

interface SharedRoute {
  readonly url: string;
}

const SHARED_ROUTES: readonly { readonly prefix: string; readonly routes: readonly SharedRoute[] }[] = [
  { prefix: definitionApi.DEFINITION_PREFIX, routes: definitionApi.definitionRoutes },
  { prefix: executionApi.EXECUTION_PREFIX, routes: executionApi.executionRoutes },
  { prefix: reportingApi.REPORTING_PREFIX, routes: reportingApi.reportingRoutes },
  { prefix: telemetryApi.TELEMETRY_PREFIX, routes: telemetryApi.telemetryRoutes },
];

function sessionRoutePaths(): string[] {
  return SHARED_ROUTES.flatMap(({ prefix, routes }) =>
    routes
      .filter((route) => route.url.includes(":sessionId"))
      .map((route) => routePath(`${prefix}${route.url}`, { id: QUESTIONNAIRE_ID, sessionId: SESSION_ID })),
  );
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
  const sessionPaths = sessionRoutePaths();

  it("finds the routes that carry a session id", () => {
    expect(sessionPaths.length).toBeGreaterThanOrEqual(3);
  });

  it.each(sessionPaths)("masks the session id in the shared route %s", (path) => {
    for (const requestUri of [path, `${path}/`, `${path}?cursor=${CURSOR}`]) {
      const route = loggedRoute(requestUri);
      expect(route).toContain(":sessionId");
      expect(route).not.toContain(SESSION_ID);
      expect(route).not.toContain(CURSOR);
    }
  });

  it("masks the session id in the admin's response detail path", () => {
    expect(loggedRoute(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/${SESSION_ID}`)).toBe(
      `/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/:sessionId`,
    );
    expect(loggedRoute(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/${SESSION_ID}?cursor=${CURSOR}`)).toBe(
      `/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/:sessionId`,
    );
  });

  it("drops the query string, so the cursor cannot be logged", () => {
    expect(loggedRoute(`/api/reporting/questionnaires/${QUESTIONNAIRE_ID}/responses?cursor=${CURSOR}&order=asc`)).toBe(
      `/api/reporting/questionnaires/${QUESTIONNAIRE_ID}/responses`,
    );
    expect(loggedRoute(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses?cursor=${CURSOR}`)).toBe(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses`);
  });

  it.each([
    ["a percent-encoded prefix", `/api/%72un/sessions/${SESSION_ID}`],
    ["a doubled leading slash", `//api/run/sessions/${SESSION_ID}`],
    ["a doubled slash inside", `/api/run//sessions/${SESSION_ID}`],
    ["a dot segment", `/api/./run/sessions/${SESSION_ID}`],
    ["a dot-dot segment", `/api/x/../run/sessions/${SESSION_ID}`],
    ["a doubled slash in the admin path", `/admin//questionnaires/${QUESTIONNAIRE_ID}/responses/${SESSION_ID}`],
    ["an absolute-form request target", `http://example.test/api/run/sessions/${SESSION_ID}`],
    ["an absolute-form request target with a port", `http://example.test:8080/api/reporting/questionnaires/${QUESTIONNAIRE_ID}/responses/${SESSION_ID}`],
    ["a dot segment in the session slot", `/api/run/sessions/./${SESSION_ID}`],
    ["a longer path under a session", `/api/run/sessions/${SESSION_ID}/anything/else`],
    ["a longer path under a response", `/api/reporting/questionnaires/${QUESTIONNAIRE_ID}/responses/${SESSION_ID}/extra`],
    ["a longer admin path under a response", `/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/${SESSION_ID}/extra`],
    ["a non-ASCII path", `/api/run/sessions/${SESSION_ID}/\u00e9`],
    ["an empty target", ""],
    ["a path with a space", `/api/run/sessions /${SESSION_ID}`],
  ])("never logs a session id for %s", (_name, requestUri) => {
    const route = loggedRoute(requestUri);
    expect(route).not.toContain(SESSION_ID);
    expect(route.toLowerCase()).not.toContain(SESSION_ID.slice(0, 8));
    expect(route).not.toContain(CURSOR);
  });

  it.each([
    `/api/%72un/sessions/${SESSION_ID}`,
    `//api/run/sessions/${SESSION_ID}`,
    `/api/./run/sessions/${SESSION_ID}`,
    `/admin//questionnaires/${QUESTIONNAIRE_ID}/responses/${SESSION_ID}`,
    `http://example.test/api/run/sessions/${SESSION_ID}`,
    `/api/run/sessions/${SESSION_ID}/anything/else`,
    "",
  ])("logs the fixed marker for the path %s", (requestUri) => {
    expect(loggedRoute(requestUri)).toBe(UNMATCHED);
  });

  it.each([
    `/api/run/sessions/${SESSION_ID.toUpperCase()}`,
    "/api/run/sessions/not-a-uuid",
    `/api/run/sessions/${SESSION_ID.replace("-", "%2D")}`,
  ])("masks whatever occupies a session slot, in %s", (requestUri) => {
    expect(loggedRoute(requestUri)).toBe("/api/run/sessions/:sessionId");
  });

  it.each([
    "/",
    "/admin/",
    "/admin/questionnaires",
    "/api/run/sessions",
    "/assets/index-abc123.js",
    "/assets/chunk.min.js",
    `/q/${QUESTIONNAIRE_ID}`,
    `/admin/questionnaires/${QUESTIONNAIRE_ID}/responses`,
    `/api/definition/questionnaires/${QUESTIONNAIRE_ID}/draft`,
    `/api/definition/questionnaires/${QUESTIONNAIRE_ID}/draft/`,
  ])("leaves the safe path %s as it is", (requestUri) => {
    expect(loggedRoute(requestUri)).toBe(requestUri);
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
