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

function headersOf(caller: Caller): Record<string, string> {
  return {
    traceparent: `00-${caller.traceId}-${caller.spanId}-01`,
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
  }));
}

type ExportedSpan = ReturnType<typeof exportedSpans>[number];

function rootOf(span: ExportedSpan, byId: ReadonlyMap<string, ExportedSpan>): ExportedSpan {
  let current = span;
  while (current.parentSpanId !== undefined) {
    const parent = byId.get(current.parentSpanId);
    if (parent === undefined) break;
    current = parent;
  }
  return current;
}

function expectEverySpanJoinsTheCaller(caller: Caller): readonly ExportedSpan[] {
  const spans = exportedSpans();
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  expect(spans.length, "the request must have produced spans for this test to prove anything").toBeGreaterThan(0);
  expect(spans.filter((span) => span.traceId !== caller.traceId).map((span) => span.name), "every span shares the caller's trace id").toEqual([]);
  expect(
    spans.filter((span) => span.parentSpanId === caller.spanId).map((span) => span.name),
    "the caller's span is the parent of the request span and of nothing else",
  ).toEqual(["request"]);
  for (const span of spans) {
    const root = rootOf(span, byId);
    expect(root.name, `${span.name} descends from the request span`).toBe("request");
    expect(root.parentSpanId).toBe(caller.spanId);
    expect(span.traceState, `${span.name} carries no tracestate`).toBeUndefined();
    expect(span.parentTraceState, `${span.name}'s parent context carries no tracestate`).toBeUndefined();
  }
  return spans;
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

function logRecordSpanContext(body: string) {
  const record = telemetry.logRecords().find((candidate) => candidate.body === body);
  if (record === undefined) {
    throw new Error(`no log record "${body}" was exported; the test proves nothing without it`);
  }
  return record.spanContext;
}

describe("a request that carries the browser's traceparent joins the browser's trace, in spans, logs and the database", () => {
  it("gives every span the caller's trace id, with the caller's span as the request span's parent, and the pg spans below it", async () => {
    const caller = aCaller();

    const response = await app.inject({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID), headers: headersOf(caller) });

    expect(response.statusCode).toBe(200);
    const spans = expectEverySpanJoinsTheCaller(caller);
    expect(spans.map((span) => span.name)).toEqual(expect.arrayContaining(["request", "reporting.list_sessions", "pg.query:SELECT"]));
    expect(spans.filter((span) => span.name.startsWith("pg.query:")).length, "the statements ran under the request").toBeGreaterThan(0);
    expectNoHostileTracestateAnywhere();
  });

  it("writes the log lines of the request under the same trace id, each with the span id of a span of that trace, and exports the same ids on the log record", async () => {
    const caller = aCaller();

    await app.inject({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID), headers: headersOf(caller) });

    const spans = expectEverySpanJoinsTheCaller(caller);
    const event = logLine("reporting.responses_listed");
    expect(event.trace_id).toBe(caller.traceId);
    const eventSpan = spans.find((span) => span.spanId === event.span_id);
    expect(eventSpan?.name, "the span id on the line is a span of the caller's trace").toBe("reporting.list_sessions");
    const withTrace = telemetry.logs().filter((line) => line.trace_id !== undefined);
    expect(withTrace.length).toBeGreaterThan(0);
    expect(withTrace.filter((line) => line.trace_id !== caller.traceId).map((line) => line.msg)).toEqual([]);
    for (const line of withTrace) {
      const namesASpanOfTheTrace = line.span_id === caller.spanId || spans.some((span) => span.spanId === line.span_id);
      expect(namesASpanOfTheTrace, `${String(line.msg)} names a span of the trace, or the caller's own`).toBe(true);
    }
    const exported = logRecordSpanContext("reporting.responses_listed");
    expect(exported?.traceId).toBe(caller.traceId);
    expect(exported?.spanId).toBe(event.span_id);
    for (const record of telemetry.logRecords()) {
      if (record.spanContext !== undefined) {
        expect(record.spanContext.traceId, `${String(record.body)} joins the caller's trace`).toBe(caller.traceId);
      }
    }
    expectNoHostileTracestateAnywhere();
  });

  it("puts the statement's own trace context and nothing else in the SQL comment Postgres shows, whatever tracestate the caller sent", async () => {
    const caller = aCaller();

    const response = await app.inject({ method: "GET", url: PROBE_PATH, headers: headersOf(caller) });

    expect(response.statusCode).toBe(200);
    const { query } = response.json<{ query: string }>();
    const comment = new RegExp(`/\\*traceparent='00-${caller.traceId}-([0-9a-f]{16})-01'\\*/$`).exec(query);
    expect(comment, "the statement's comment holds traceparent alone, in the caller's trace").not.toBeNull();
    expect(query).not.toContain("tracestate");
    expect(query).not.toContain(HOSTILE_TRACESTATE_VALUE);
    const spans = expectEverySpanJoinsTheCaller(caller);
    expect(spans.find((span) => span.spanId === comment?.[1])?.name, "the span id in the comment is a pg span of the trace").toBe("pg.query:SELECT");
    expectNoHostileTracestateAnywhere();
  });

  it("starts a new trace, and carries on, when the traceparent is not one", async () => {
    const response = await app.inject({
      method: "GET",
      url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID),
      headers: { traceparent: "not-a-traceparent", tracestate: `vendor=${HOSTILE_TRACESTATE_VALUE}` },
    });

    expect(response.statusCode).toBe(200);
    const request = exportedSpans().find((span) => span.name === "request");
    expect(request?.parentSpanId).toBeUndefined();
    expect(request?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(logLine("reporting.responses_listed").trace_id).toBe(request?.traceId);
    expectNoHostileTracestateAnywhere();
  });
});

describe("a telemetry batch posted with the browser's traceparent header and its own event traceparents", () => {
  it("runs the request in the header's trace, logs an event without a traceparent under the ingest span, and logs an event with one under the trace and span it names", async () => {
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
    const spans = expectEverySpanJoinsTheCaller(caller);
    const ingest = spans.find((span) => span.name === "telemetry.ingest");
    expect(ingest, "the ingest ran under a span of the request's trace").toBeDefined();
    expect(spans.filter((span) => span.traceId === eventTrace.traceId), "an event's traceparent creates no span").toEqual([]);

    const withoutParent = logLine("client.info");
    expect(withoutParent.trace_id).toBe(caller.traceId);
    expect(withoutParent.span_id).toBe(ingest?.spanId);
    const warned = logLine("client.warn");
    expect(warned).toMatchObject({ trace_id: eventTrace.traceId, span_id: eventTrace.spanId, module: "browser" });
    const abandoned = logLine("session.abandoned");
    expect(abandoned).toMatchObject({ trace_id: eventTrace.traceId, span_id: secondEventSpan });

    expect(logRecordSpanContext("client.info")).toMatchObject({ traceId: caller.traceId, spanId: ingest?.spanId });
    expect(logRecordSpanContext("client.warn")).toMatchObject({ traceId: eventTrace.traceId, spanId: eventTrace.spanId });
    expect(logRecordSpanContext("session.abandoned")).toMatchObject({ traceId: eventTrace.traceId, spanId: secondEventSpan });
    expectNoHostileTracestateAnywhere();
  });
});
