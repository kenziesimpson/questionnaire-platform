import { randomBytes } from "node:crypto";
import { telemetryApi } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { requestLogger } from "../src/http/request-logger.js";
import { useTestDatabase } from "./db/fixtures.js";
import { seedIntakeV1 } from "./modules/execution/fixtures.js";
import { listSessionsUrl } from "./modules/reporting/fixtures.js";

const testDatabase = useTestDatabase();

const PROBE_PATH = "/trace-continuity-probe";

const HOSTILE_TRACESTATE_VALUE = "TRACESTATE_DIABETES_8F3A";

const CLIENT_TRACE_ATTRIBUTE = "client.trace_id";

let telemetry: TestTelemetry;
let app: FastifyInstance;

beforeEach(async () => {
  await seedIntakeV1(testDatabase);
  telemetry = installTestTelemetry({ logLevel: "debug", autoInstrumentation: true, loadedDatabaseDriver: pg });
  app = await buildApp({
    logger: requestLogger("debug"),
    definition: { database: testDatabase.database("definition") },
    execution: { database: testDatabase.database("execution") },
    reporting: { reporting: testDatabase.database("reporting") },
  });
  app.get(PROBE_PATH, async () => {
    const result = await testDatabase.pool("reporting").query<{ query: string }>("SELECT query FROM pg_stat_activity WHERE pid = pg_backend_pid()");
    return { query: result.rows[0]?.query };
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await telemetry.shutdown();
});

interface Caller {
  readonly traceId: string;
  readonly spanId: string;
}

function aCaller(): Caller {
  return { traceId: randomBytes(16).toString("hex"), spanId: randomBytes(8).toString("hex") };
}

function headersOf(caller: Caller, flags = "01"): Record<string, string> {
  return {
    traceparent: `00-${caller.traceId}-${caller.spanId}-${flags}`,
    tracestate: `vendor=${HOSTILE_TRACESTATE_VALUE},${"k".repeat(200)}=${"v".repeat(250)}`,
  };
}

function exportedSpans() {
  return telemetry.spans().map((span) => ({
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    traceState: span.spanContext().traceState?.serialize(),
    parentTraceState: span.parentSpanContext?.traceState?.serialize(),
    clientTraceId: span.attributes[CLIENT_TRACE_ATTRIBUTE],
  }));
}

type ExportedSpan = ReturnType<typeof exportedSpans>[number];

function requestSpanOf(spans: readonly ExportedSpan[]): ExportedSpan {
  const request = spans.find((span) => span.name === "request");
  if (request === undefined) {
    throw new Error("no request span was exported; the test proves nothing without it");
  }
  return request;
}

function expectOneBackendTrace(caller: Caller): { readonly spans: readonly ExportedSpan[]; readonly traceId: string; readonly request: ExportedSpan } {
  const spans = exportedSpans();
  expect(spans.length, "the request must have produced spans for this test to prove anything").toBeGreaterThan(0);
  const traceIds = [...new Set(spans.map((span) => span.traceId))];
  expect(traceIds, "every span of the request is in one trace").toHaveLength(1);
  const [traceId = ""] = traceIds;
  expect(traceId, "the trace id is the backend's own").toMatch(/^[0-9a-f]{32}$/);
  expect(traceId, "and not the caller's").not.toBe(caller.traceId);
  expect(spans.filter((span) => span.parentSpanId === caller.spanId).map((span) => span.name), "the caller's span is nobody's parent").toEqual([]);
  const request = requestSpanOf(spans);
  expect(request.parentSpanId, "the request span is the root of its trace").toBeUndefined();
  for (const span of spans) {
    expect(span.traceState, `${span.name} carries no tracestate`).toBeUndefined();
    expect(span.parentTraceState, `${span.name}'s parent context carries no tracestate`).toBeUndefined();
  }
  return { spans, traceId, request };
}

function expectClientTraceIdOnTheRequestSpanOnly(spans: readonly ExportedSpan[], caller: Caller): void {
  expect(requestSpanOf(spans).clientTraceId).toBe(caller.traceId);
  expect(spans.filter((span) => span.name !== "request" && span.clientTraceId !== undefined).map((span) => span.name)).toEqual([]);
}

function expectNoHostileTracestateAnywhere(): void {
  expect(JSON.stringify(telemetry.spans().map((span) => ({ name: span.name, attributes: span.attributes, events: span.events, links: span.links })))).not.toContain(
    HOSTILE_TRACESTATE_VALUE,
  );
  expect(JSON.stringify(telemetry.logs())).not.toContain(HOSTILE_TRACESTATE_VALUE);
  expect(JSON.stringify(telemetry.logRecords().map((record) => ({ body: record.body, attributes: record.attributes })))).not.toContain(HOSTILE_TRACESTATE_VALUE);
}

function logLine(message: string): Record<string, unknown> {
  const line = telemetry.logs().find((candidate) => candidate.msg === message);
  if (line === undefined) {
    throw new Error(`no log line "${message}" was written; the test proves nothing without it`);
  }
  return line;
}

function logRecord(body: string) {
  const record = telemetry.logRecords().find((candidate) => candidate.body === body);
  if (record === undefined) {
    throw new Error(`no log record "${body}" was exported; the test proves nothing without it`);
  }
  return record;
}

describe("a request that carries the browser's traceparent starts a trace of its own and records the browser's trace id as client.trace_id", () => {
  it("gives every span the backend's own trace id, with the request span as the root, the pg spans below it, and the caller's trace id on the request span only", async () => {
    const caller = aCaller();

    const response = await app.inject({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID), headers: headersOf(caller) });

    expect(response.statusCode).toBe(200);
    const { spans } = expectOneBackendTrace(caller);
    expect(spans.map((span) => span.name)).toEqual(expect.arrayContaining(["request", "reporting.list_sessions", "pg.query:SELECT"]));
    expect(spans.filter((span) => span.name.startsWith("pg.query:")).length, "the statements ran under the request").toBeGreaterThan(0);
    expectClientTraceIdOnTheRequestSpanOnly(spans, caller);
    expectNoHostileTracestateAnywhere();
  });

  it("writes the log lines of the request under the backend's trace, each with the client trace id, and exports the same on the log record", async () => {
    const caller = aCaller();

    await app.inject({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID), headers: headersOf(caller) });

    const { spans, traceId } = expectOneBackendTrace(caller);
    const event = logLine("reporting.responses_listed");
    expect(event.trace_id).toBe(traceId);
    expect(event[CLIENT_TRACE_ATTRIBUTE]).toBe(caller.traceId);
    expect(spans.find((span) => span.spanId === event.span_id)?.name, "the span id on the line is a span of the backend's trace").toBe("reporting.list_sessions");
    const traced = telemetry.logs().filter((line) => line.trace_id !== undefined);
    expect(traced.length).toBeGreaterThan(0);
    for (const line of traced) {
      expect(line.trace_id, `${String(line.msg)} is under the backend's trace`).toBe(traceId);
      expect(line[CLIENT_TRACE_ATTRIBUTE], `${String(line.msg)} carries the client trace id`).toBe(caller.traceId);
    }
    for (const line of telemetry.logs().filter((candidate) => candidate.trace_id === undefined)) {
      expect(line, `${String(line.msg)} is outside the request span and outside the client trace`).not.toHaveProperty([CLIENT_TRACE_ATTRIBUTE]);
    }
    const exported = logRecord("reporting.responses_listed");
    expect(exported.spanContext?.traceId).toBe(traceId);
    expect(exported.spanContext?.spanId).toBe(event.span_id);
    expect(exported.attributes[CLIENT_TRACE_ATTRIBUTE]).toBe(caller.traceId);
    expect(exported.attributes).not.toHaveProperty("trace_id");
    for (const record of telemetry.logRecords()) {
      if (record.spanContext === undefined) {
        expect(record.attributes).not.toHaveProperty([CLIENT_TRACE_ATTRIBUTE]);
      } else {
        expect(record.spanContext.traceId, `${String(record.body)} is under the backend's trace`).toBe(traceId);
        expect(record.attributes[CLIENT_TRACE_ATTRIBUTE], `${String(record.body)} carries the client trace id`).toBe(caller.traceId);
      }
    }
    expectNoHostileTracestateAnywhere();
  });

  it("names, in the SQL comment Postgres shows, a pg.query span of the backend's trace and never the caller's trace id, on the real app", async () => {
    const caller = aCaller();

    const response = await app.inject({ method: "GET", url: PROBE_PATH, headers: headersOf(caller) });

    expect(response.statusCode).toBe(200);
    const { query } = response.json<{ query: string }>();
    const comment = /\/\*traceparent='00-([0-9a-f]{32})-([0-9a-f]{16})-01'\*\/$/.exec(query);
    expect(comment, "the statement carries a traceparent comment").not.toBeNull();
    const { spans, traceId } = expectOneBackendTrace(caller);
    expect(comment?.[1], "the comment names the backend's trace").toBe(traceId);
    expect(spans.find((span) => span.spanId === comment?.[2])?.name, "the span id in the comment is a pg span of the trace").toBe("pg.query:SELECT");
    expect(query).not.toContain(caller.traceId);
    expect(query).not.toContain(caller.spanId);
    expect(query).not.toContain("tracestate");
    expect(query).not.toContain(HOSTILE_TRACESTATE_VALUE);
  });

  it("does not let the caller's not-sampled flag hide the request: the spans are recorded and exported", async () => {
    const caller = aCaller();

    const response = await app.inject({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID), headers: headersOf(caller, "00") });

    expect(response.statusCode).toBe(200);
    const { spans, request } = expectOneBackendTrace(caller);
    expect(spans.map((span) => span.name)).toEqual(expect.arrayContaining(["request", "reporting.list_sessions", "pg.query:SELECT"]));
    expect(request.clientTraceId).toBe(caller.traceId);
    expect(logLine("reporting.responses_listed")[CLIENT_TRACE_ATTRIBUTE]).toBe(caller.traceId);
  });

  it("makes many requests from one page many backend traces that all carry the page's client trace id", async () => {
    const page = aCaller();
    const REQUESTS = 4;

    for (let count = 0; count < REQUESTS; count += 1) {
      const fresh = { traceId: page.traceId, spanId: randomBytes(8).toString("hex") };
      const response = await app.inject({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID), headers: headersOf(fresh, "00") });
      expect(response.statusCode).toBe(200);
    }

    const spans = exportedSpans();
    const requests = spans.filter((span) => span.name === "request");
    expect(requests).toHaveLength(REQUESTS);
    expect(new Set(requests.map((request) => request.traceId)).size, "one backend trace for each request").toBe(REQUESTS);
    expect(requests.map((request) => request.clientTraceId)).toEqual(Array.from({ length: REQUESTS }, () => page.traceId));
    expect(spans.filter((span) => span.traceId === page.traceId)).toEqual([]);
    const listed = telemetry.logs().filter((line) => line.msg === "reporting.responses_listed");
    expect(listed).toHaveLength(REQUESTS);
    expect(new Set(listed.map((line) => line.trace_id)).size).toBe(REQUESTS);
    expect(listed.map((line) => line[CLIENT_TRACE_ATTRIBUTE])).toEqual(Array.from({ length: REQUESTS }, () => page.traceId));
  });

  it.each([
    ["not a traceparent", "not-a-traceparent"],
    ["an oversized trace id", `00-${"a".repeat(4096)}-b7ad6b7169203331-01`],
    ["a sentinel in every position", `${HOSTILE_TRACESTATE_VALUE}-${HOSTILE_TRACESTATE_VALUE}-${HOSTILE_TRACESTATE_VALUE}-${HOSTILE_TRACESTATE_VALUE}`],
    ["an all-zero trace id", `00-${"0".repeat(32)}-b7ad6b7169203331-01`],
  ])("starts an ordinary trace with no client trace id, and carries on, when the traceparent is %s", async (_name, traceparent) => {
    const response = await app.inject({
      method: "GET",
      url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID),
      headers: { traceparent, tracestate: `vendor=${HOSTILE_TRACESTATE_VALUE}` },
    });

    expect(response.statusCode).toBe(200);
    const request = requestSpanOf(exportedSpans());
    expect(request.parentSpanId).toBeUndefined();
    expect(request.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(request.clientTraceId).toBeUndefined();
    expect(logLine("reporting.responses_listed").trace_id).toBe(request.traceId);
    expect(logLine("reporting.responses_listed")).not.toHaveProperty([CLIENT_TRACE_ATTRIBUTE]);
    expect(JSON.stringify(exportedSpans())).not.toContain(HOSTILE_TRACESTATE_VALUE);
    expectNoHostileTracestateAnywhere();
  });
});

describe("a telemetry batch posted with the browser's traceparent header and its own event traceparents", () => {
  it("runs the request in a trace of its own, and logs each event under that trace with the client trace id its own traceparent named, or none", async () => {
    const caller = aCaller();
    const eventTrace = aCaller();
    const secondEventSpan = randomBytes(8).toString("hex");
    const at = new Date().toISOString();

    const response = await app.inject({
      method: "POST",
      url: telemetryApi.TELEMETRY_PREFIX,
      headers: headersOf(caller),
      payload: {
        events: [
          { name: "client.info", at },
          { name: "client.warn", at, traceparent: `00-${eventTrace.traceId}-${eventTrace.spanId}-01`, fields: { errorType: "TypeError" } },
          {
            name: "session.abandoned",
            at,
            traceparent: `00-${eventTrace.traceId}-${secondEventSpan}-01`,
            fields: { sessionId: "5b1e7c2a-3d4f-4a6b-8c9d-0e1f2a3b4c5d", lastItemId: "itm_02" },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 3, dropped: 0 });
    const { spans, traceId } = expectOneBackendTrace(caller);
    const ingest = spans.find((span) => span.name === "telemetry.ingest");
    expect(ingest, "the ingest ran under a span of the request's own trace").toBeDefined();
    expectClientTraceIdOnTheRequestSpanOnly(spans, caller);

    for (const message of ["client.info", "client.warn", "session.abandoned"]) {
      expect(logLine(message), `${message} is under the ingest request's trace, not the browser's`).toMatchObject({ trace_id: traceId, span_id: ingest?.spanId });
    }
    expect(logLine("client.info")).not.toHaveProperty([CLIENT_TRACE_ATTRIBUTE]);
    expect(logLine("client.warn")).toMatchObject({ [CLIENT_TRACE_ATTRIBUTE]: eventTrace.traceId, module: "browser" });
    expect(logLine("session.abandoned")).toMatchObject({ [CLIENT_TRACE_ATTRIBUTE]: eventTrace.traceId });

    expect(logRecord("client.info").spanContext).toMatchObject({ traceId, spanId: ingest?.spanId });
    expect(logRecord("client.info").attributes).not.toHaveProperty([CLIENT_TRACE_ATTRIBUTE]);
    expect(logRecord("client.warn").spanContext).toMatchObject({ traceId, spanId: ingest?.spanId });
    expect(logRecord("client.warn").attributes[CLIENT_TRACE_ATTRIBUTE]).toBe(eventTrace.traceId);
    expect(logRecord("session.abandoned").attributes[CLIENT_TRACE_ATTRIBUTE]).toBe(eventTrace.traceId);
    expect(telemetry.logs().filter((line) => line.trace_id === eventTrace.traceId)).toEqual([]);
    expectNoHostileTracestateAnywhere();
  });
});
