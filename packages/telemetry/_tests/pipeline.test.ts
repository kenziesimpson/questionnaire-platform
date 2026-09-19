import { context, metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { sensitive } from "@qp/shared";
import { afterEach, describe, expect, it } from "vitest";
import { activeTraceId, annotateActiveSpan, emitDomainEvent, logger, withSpan } from "../src/index.js";
import { SPAN_NAMES } from "../src/spans.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { SESSION_ID, QUESTIONNAIRE_ID, QUESTION_ID } from "./fixtures.js";

const LEAK = "LEAK_DIABETES_8F3A";

let telemetry: TestTelemetry;

function install(): TestTelemetry {
  telemetry = installTestTelemetry();
  return telemetry;
}

afterEach(async () => {
  await telemetry.shutdown();
});

async function metricNamed(installed: TestTelemetry, name: string) {
  const all = await installed.metrics();
  return all.find((metric) => metric.descriptor.name === name);
}

describe("withSpan against the real SDK", () => {
  it("records a span with the registered context as attributes", async () => {
    const installed = install();
    await withSpan("questionnaire.publish", { questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 3 }, async () => undefined);
    const [span] = installed.spans();
    expect(span?.name).toBe("questionnaire.publish");
    expect(span?.attributes).toEqual({ "questionnaire.id": QUESTIONNAIRE_ID, "questionnaire.version": 3 });
    expect(span?.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns the callback's value and nests a child span under the parent", async () => {
    const installed = install();
    const value = await withSpan("session.submit", { sessionId: SESSION_ID }, () =>
      withSpan("rule.evaluate", { sessionId: SESSION_ID }, async () => 7),
    );
    expect(value).toBe(7);
    const child = installed.spans().find((span) => span.name === "rule.evaluate");
    const parent = installed.spans().find((span) => span.name === "session.submit");
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });

  it("marks a failure with the error type only and rethrows it", async () => {
    const installed = install();
    await expect(
      withSpan("session.submit", { sessionId: SESSION_ID }, async () => {
        throw new RangeError(`bad ${LEAK}`);
      }),
    ).rejects.toThrow(RangeError);
    const [span] = installed.spans();
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(span?.attributes["error.type"]).toBe("RangeError");
    expect(JSON.stringify(span)).not.toContain(LEAK);
  });
});

describe("a span name outside the closed list", () => {
  it("runs the callback without a span, returns its value and counts one unknown span drop", async () => {
    const installed = install();
    // @ts-expect-error — not a SpanName
    const value = await withSpan(LEAK, { sessionId: SESSION_ID }, async () => 7);
    expect(value).toBe(7);
    expect(installed.spans()).toEqual([]);
    const dropped = await metricNamed(installed, "telemetry.scrub.dropped");
    expect(dropped?.dataPoints.map((point) => [point.attributes["telemetry.signal"], point.attributes["telemetry.reason"], point.value])).toEqual([
      ["span", "unknown", 1],
    ]);
  });

  it("does not become the active span for logs written inside the callback", async () => {
    const installed = install();
    // @ts-expect-error — not a SpanName
    await withSpan("not.a.span", {}, async () => {
      logger("execution").info("inside");
    });
    expect(installed.logs()[0]).not.toHaveProperty("trace_id");
  });

  it("rethrows what the callback throws, and never throws for the name itself", async () => {
    install();
    // @ts-expect-error — not a SpanName
    await expect(withSpan(LEAK, {}, async () => Promise.reject(new RangeError("x")))).rejects.toThrow(RangeError);
    // @ts-expect-error — not a SpanName
    await expect(withSpan(undefined, {}, async () => 1)).resolves.toBe(1);
  });
});

describe("the exporter allowlist", () => {
  it("strips a third-party span's attributes and exception details before export", () => {
    const installed = install();
    const span = trace.getTracer("third-party").startSpan("GET", {
      attributes: {
        "url.path": `/sessions/${LEAK}`,
        "http.request.body": LEAK,
        "http.route": "/sessions/:sessionId",
      },
    });
    span.recordException(new Error(`failed ${LEAK}`));
    span.setStatus({ code: SpanStatusCode.ERROR, message: `failed ${LEAK}` });
    span.end();
    const [exported] = installed.spans();
    expect(exported?.attributes).toEqual({ "http.route": "/sessions/:sessionId" });
    expect(exported?.events.map((event) => event.name)).toEqual(["exception"]);
    expect(exported?.events[0]?.attributes).toEqual({ "exception.type": "Error" });
    expect(exported?.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(JSON.stringify(exported)).not.toContain(LEAK);
  });

  it("counts what it drops in telemetry.scrub.dropped by signal and reason", async () => {
    const installed = install();
    const span = trace.getTracer("third-party").startSpan("GET", { attributes: { "url.path": "/x", "http.request.body": LEAK } });
    span.end();
    metrics.getMeter("third-party").createCounter("orders").add(1, { "questionnaire.session_id": SESSION_ID, "questionnaire.outcome": "accepted" });
    await installed.metrics();
    const dropped = await metricNamed(installed, "telemetry.scrub.dropped");
    const bySeries = Object.fromEntries(
      (dropped?.dataPoints ?? []).map((point) => [`${point.attributes["telemetry.signal"]}/${point.attributes["telemetry.reason"]}`, point.value]),
    );
    expect(bySeries["span/unknown"]).toBe(3);
    expect(bySeries["metric/unbounded"]).toBe(1);
  });

  it.each([
    "request",
    "handler - getSession",
    "handler - ready",
    "handler - handler",
    "handler - anonymous",
    "handler - fastify -> @fastify/otel",
    "onRequest - anonymous",
    "onSend - executionModule",
    "notFoundHandler - replyNotFound",
    "notFoundHandler - preHandler - authenticateAuthor",
    "pg.query",
    "pg.query:SELECT",
    "pg.query:BEGIN",
    "pg.connect",
    "pg-pool.connect",
  ])("exports the auto-instrumented span name %s unchanged", (name) => {
    const installed = install();
    trace.getTracer("third-party").startSpan(name).end();
    expect(installed.spans().map((span) => span.name)).toEqual([name]);
  });

  it.each([
    ["pg.query:SELECT qp", "pg.query:SELECT"],
    ["pg.query:INSERT questionnaire_platform", "pg.query:INSERT"],
    [`pg.query:SELECT ${LEAK}`, "pg.query:SELECT"],
    [`pg.query:SELECT ${LEAK.toLowerCase()}`, "pg.query:SELECT"],
  ])("exports the pg query span %s without its database slot, as %s, and counts no drop", async (name, exported) => {
    const installed = install();
    trace.getTracer("third-party").startSpan(name).end();
    expect(installed.spans().map((span) => span.name)).toEqual([exported]);
    expect(await metricNamed(installed, "telemetry.scrub.dropped")).toBeUndefined();
  });

  it.each([
    LEAK,
    LEAK.toLowerCase(),
    `handler - ${LEAK} and more`,
    `handler - ${LEAK}`,
    `handler - ${LEAK.toLowerCase()}`,
    "handler - has_underscore",
    "handler - Capitalised",
    "handler - two words",
    "handler - fastify -> @fastify/cors",
    "GET /sessions/abc",
    "pg.query:SELECT * FROM t",
    `pg.query:${LEAK}`,
    `pg.query:${LEAK.toLowerCase()}`,
    "pg.query:select",
    "pg.query:UNKNOWNVERB",
    `pg.query:${LEAK}\n`,
    "",
    "handler - ",
  ])("exports a span named %j as unnamed, keeps the span and counts the name as unknown", async (name) => {
    const installed = install();
    const outer = trace.getTracer("third-party").startSpan(name);
    trace.getTracer("third-party").startSpan("pg.connect", {}, trace.setSpan(context.active(), outer)).end();
    outer.end();
    const exported = installed.spans();
    expect(exported.map((span) => span.name).sort()).toEqual(["pg.connect", "unnamed"]);
    expect(exported.find((span) => span.name === "pg.connect")?.parentSpanContext?.spanId).toBe(
      exported.find((span) => span.name === "unnamed")?.spanContext().spanId,
    );
    expect(JSON.stringify(exported).toLowerCase()).not.toContain(LEAK.toLowerCase());
    const dropped = await metricNamed(installed, "telemetry.scrub.dropped");
    expect(dropped?.dataPoints.map((point) => [point.attributes["telemetry.signal"], point.attributes["telemetry.reason"], point.value])).toEqual([
      ["span", "unknown", 1],
    ]);
  });

  it("exports each name a caller can declare through withSpan unchanged", async () => {
    const installed = install();
    for (const name of SPAN_NAMES) await withSpan(name, {}, async () => undefined);
    expect(installed.spans().map((span) => span.name)).toEqual([...SPAN_NAMES]);
  });

  it("keeps an unbounded identifier off every metric", async () => {
    const installed = install();
    metrics.getMeter("third-party").createCounter("orders").add(1, { "questionnaire.session_id": SESSION_ID, "questionnaire.outcome": "accepted" });
    const orders = await metricNamed(installed, "orders");
    expect(orders?.dataPoints.map((point) => point.attributes)).toEqual([{ "questionnaire.outcome": "accepted" }]);
  });
});

describe("emitDomainEvent against the real SDK", () => {
  it("writes one info line named for the event and counts it", async () => {
    const installed = install();
    emitDomainEvent({ name: "session.started", sessionId: SESSION_ID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 2 });
    expect(installed.logs()).toHaveLength(1);
    expect(installed.logs()[0]).toMatchObject({
      level: "info",
      msg: "session.started",
      module: "events",
      "questionnaire.session_id": SESSION_ID,
      "questionnaire.id": QUESTIONNAIRE_ID,
      "questionnaire.version": 2,
    });
    const started = await metricNamed(installed, "questionnaire.sessions.started");
    expect(started?.dataPoints.map((point) => point.value)).toEqual([1]);
  });

  it("labels a counter with bounded dimensions only", async () => {
    const installed = install();
    emitDomainEvent({ name: "session.answer_rejected", sessionId: SESSION_ID, itemId: "itm_1", questionId: QUESTION_ID, reason: "answer/required" });
    emitDomainEvent({ name: "session.question_answered", sessionId: SESSION_ID, itemId: "itm_1", questionId: QUESTION_ID, questionType: "date" });
    const rejected = await metricNamed(installed, "questionnaire.answers.rejected");
    const accepted = await metricNamed(installed, "questionnaire.answers.accepted");
    expect(rejected?.dataPoints.map((point) => point.attributes)).toEqual([{ "questionnaire.reason": "answer/required" }]);
    expect(accepted?.dataPoints.map((point) => point.attributes)).toEqual([{ "questionnaire.question_type": "date" }]);
  });

  it("records a completed session's duration", async () => {
    const installed = install();
    emitDomainEvent({ name: "session.completed", sessionId: SESSION_ID, durationMs: 1200, questionCount: 6 });
    const duration = await metricNamed(installed, "questionnaire.session.duration");
    expect(duration?.dataPoints).toHaveLength(1);
    const completed = await metricNamed(installed, "questionnaire.sessions.completed");
    expect(completed?.dataPoints.map((point) => point.value)).toEqual([1]);
  });

  it("logs a null last item as an absent field", () => {
    const installed = install();
    emitDomainEvent({ name: "session.abandoned", sessionId: SESSION_ID, lastItemId: null });
    expect(installed.logs()[0]).not.toHaveProperty("questionnaire.last_item_id");
  });

  it("logs a rejection with no item or question as a line without those fields, and still counts its reason", async () => {
    const installed = install();
    emitDomainEvent({ name: "session.answer_rejected", sessionId: SESSION_ID, itemId: null, questionId: null, reason: "answer/unknown-item" });
    expect(installed.logs()[0]).not.toHaveProperty("questionnaire.item_id");
    expect(installed.logs()[0]).not.toHaveProperty("questionnaire.question_id");
    const rejected = await metricNamed(installed, "questionnaire.answers.rejected");
    expect(rejected?.dataPoints.map((point) => point.attributes)).toEqual([{ "questionnaire.reason": "answer/unknown-item" }]);
  });

  it("counts a submit by its outcome and a past-cutoff rejection with no label", async () => {
    const installed = install();
    const session = { sessionId: SESSION_ID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 2 };
    emitDomainEvent({ name: "session.submit_finished", ...session, outcome: "rejected_conflict" });
    emitDomainEvent({ name: "session.rejected_past_cutoff", ...session });
    const submissions = await metricNamed(installed, "questionnaire.submissions");
    const pastCutoff = await metricNamed(installed, "questionnaire.sessions.rejected_past_cutoff");
    expect(submissions?.dataPoints.map((point) => point.attributes)).toEqual([{ "questionnaire.outcome": "rejected_conflict" }]);
    expect(pastCutoff?.dataPoints.map((point) => point.attributes)).toEqual([{}]);
  });
});

async function everythingExported(installed: TestTelemetry): Promise<string> {
  const metricData = await installed.metrics();
  return JSON.stringify({
    logs: installed.logs(),
    spans: installed.spans().map((span) => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })),
    metrics: metricData.map((metric) => ({ descriptor: metric.descriptor, points: metric.dataPoints.map((point) => point.attributes) })),
  });
}

describe("a Sensitive value never reaches an exporter", () => {
  it("is refused by the types and dropped at runtime in a log, a span and a domain event", async () => {
    const installed = install();
    const answer = sensitive(LEAK);
    const log = logger("execution");

    // @ts-expect-error — a Sensitive is not a registered field's type
    log.info("answered", { sessionId: answer });
    // @ts-expect-error — nor is it accepted as a span attribute
    await withSpan("session.submit", { itemId: answer }, async () => undefined);
    // @ts-expect-error — nor as an event field
    emitDomainEvent({ name: "session.item_skipped", sessionId: answer, itemId: "itm_1", questionId: QUESTION_ID });

    expect(await everythingExported(installed)).not.toContain(LEAK);
  });

  it("is dropped when a third-party span carries its string form", async () => {
    const installed = install();
    const answer = sensitive(LEAK);
    trace.getTracer("third-party").startSpan("GET", { attributes: { "questionnaire.item_id": String(answer) } }).end();
    expect(await everythingExported(installed)).not.toContain(LEAK);
  });

  it("serializes as [redacted] when a caller stringifies it into a permitted field", async () => {
    const installed = install();
    const answer = sensitive(LEAK);
    logger("execution").info("answered", { itemId: `${answer}` });
    expect(await everythingExported(installed)).not.toContain(LEAK);
  });
});

describe("the active trace id", () => {
  it("is undefined outside a span and the trace id inside one", async () => {
    install();
    expect(activeTraceId()).toBeUndefined();
    let inside: string | undefined;
    await withSpan("session.submit", {}, async () => {
      inside = activeTraceId();
    });
    expect(inside).toBe(telemetry.spans()[0]?.spanContext().traceId);
    expect(inside).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("annotateActiveSpan", () => {
  it("adds registered fields and the error type to the active span and drops the rest", async () => {
    const installed = install();
    const failure = new RangeError(`bad ${LEAK}`);
    await withSpan("session.submit", {}, async () => {
      annotateActiveSpan({ invariant: "session.not-marked-submitted", sessionId: SESSION_ID, errorCode: `bad ${LEAK}` }, failure);
    });
    const [span] = installed.spans();
    expect(span?.attributes).toEqual({
      "error.invariant": "session.not-marked-submitted",
      "questionnaire.session_id": SESSION_ID,
      "error.type": "RangeError",
    });
    expect(JSON.stringify(span)).not.toContain(LEAK);
  });

  it("does nothing outside a span", () => {
    install();
    expect(() => annotateActiveSpan({ sessionId: SESSION_ID })).not.toThrow();
  });
});
