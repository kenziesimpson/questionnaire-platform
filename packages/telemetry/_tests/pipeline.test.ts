import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { sensitive } from "@qp/shared";
import { afterEach, describe, expect, it } from "vitest";
import { emitDomainEvent, logger, withSpan } from "../src/index.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";

const CANARY = "CANARY_DIABETES_8F3A";

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
    await withSpan("questionnaire.publish", { questionnaireId: "q-1", questionnaireVersion: 3 }, async () => undefined);
    const [span] = installed.spans();
    expect(span?.name).toBe("questionnaire.publish");
    expect(span?.attributes).toEqual({ "questionnaire.id": "q-1", "questionnaire.version": 3 });
    expect(span?.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns the callback's value and nests a child span under the parent", async () => {
    const installed = install();
    const value = await withSpan("session.submit", { sessionId: "s-1" }, () =>
      withSpan("rule.evaluate", { sessionId: "s-1" }, async () => 7),
    );
    expect(value).toBe(7);
    const child = installed.spans().find((span) => span.name === "rule.evaluate");
    const parent = installed.spans().find((span) => span.name === "session.submit");
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });

  it("marks a failure with the error type only and rethrows it", async () => {
    const installed = install();
    await expect(
      withSpan("session.submit", { sessionId: "s-1" }, async () => {
        throw new RangeError(`bad ${CANARY}`);
      }),
    ).rejects.toThrow(RangeError);
    const [span] = installed.spans();
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(span?.attributes["error.type"]).toBe("RangeError");
    expect(JSON.stringify(span)).not.toContain(CANARY);
  });
});

describe("the exporter allowlist", () => {
  it("strips a third-party span's attributes and exception details before export", () => {
    const installed = install();
    const span = trace.getTracer("third-party").startSpan("GET", {
      attributes: {
        "url.path": `/sessions/${CANARY}`,
        "http.request.body": CANARY,
        "http.route": "/sessions/:sessionId",
      },
    });
    span.recordException(new Error(`failed ${CANARY}`));
    span.setStatus({ code: SpanStatusCode.ERROR, message: `failed ${CANARY}` });
    span.end();
    const [exported] = installed.spans();
    expect(exported?.attributes).toEqual({ "http.route": "/sessions/:sessionId" });
    expect(exported?.events.map((event) => event.name)).toEqual(["exception"]);
    expect(exported?.events[0]?.attributes).toEqual({ "exception.type": "Error" });
    expect(exported?.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(JSON.stringify(exported)).not.toContain(CANARY);
  });

  it("counts what it drops in telemetry.scrub.dropped by signal and reason", async () => {
    const installed = install();
    const span = trace.getTracer("third-party").startSpan("GET", { attributes: { "url.path": "/x", "http.request.body": CANARY } });
    span.end();
    metrics.getMeter("third-party").createCounter("orders").add(1, { "questionnaire.session_id": "s-1", "questionnaire.outcome": "accepted" });
    await installed.metrics();
    const dropped = await metricNamed(installed, "telemetry.scrub.dropped");
    const bySeries = Object.fromEntries(
      (dropped?.dataPoints ?? []).map((point) => [`${point.attributes["telemetry.signal"]}/${point.attributes["telemetry.reason"]}`, point.value]),
    );
    expect(bySeries["span/unknown"]).toBe(2);
    expect(bySeries["metric/unbounded"]).toBe(1);
  });

  it("keeps an unbounded identifier off every metric", async () => {
    const installed = install();
    metrics.getMeter("third-party").createCounter("orders").add(1, { "questionnaire.session_id": "s-1", "questionnaire.outcome": "accepted" });
    const orders = await metricNamed(installed, "orders");
    expect(orders?.dataPoints.map((point) => point.attributes)).toEqual([{ "questionnaire.outcome": "accepted" }]);
  });
});

describe("emitDomainEvent against the real SDK", () => {
  it("writes one info line named for the event and counts it", async () => {
    const installed = install();
    emitDomainEvent({ name: "session.started", sessionId: "s-1", questionnaireId: "q-1", questionnaireVersion: 2 });
    expect(installed.logs()).toHaveLength(1);
    expect(installed.logs()[0]).toMatchObject({
      level: "info",
      msg: "session.started",
      module: "events",
      "questionnaire.session_id": "s-1",
      "questionnaire.id": "q-1",
      "questionnaire.version": 2,
    });
    const started = await metricNamed(installed, "questionnaire.sessions.started");
    expect(started?.dataPoints.map((point) => point.value)).toEqual([1]);
  });

  it("labels a counter with bounded dimensions only", async () => {
    const installed = install();
    emitDomainEvent({ name: "session.answer_rejected", sessionId: "s-1", itemId: "itm_1", questionId: "q-1", reason: "answer/required" });
    emitDomainEvent({ name: "session.question_answered", sessionId: "s-1", itemId: "itm_1", questionId: "q-1", questionType: "date" });
    const rejected = await metricNamed(installed, "questionnaire.answers.rejected");
    const accepted = await metricNamed(installed, "questionnaire.answers.accepted");
    expect(rejected?.dataPoints.map((point) => point.attributes)).toEqual([{ "questionnaire.reason": "answer/required" }]);
    expect(accepted?.dataPoints.map((point) => point.attributes)).toEqual([{ "questionnaire.question_type": "date" }]);
  });

  it("records a completed session's duration", async () => {
    const installed = install();
    emitDomainEvent({ name: "session.completed", sessionId: "s-1", durationMs: 1200, questionCount: 6 });
    const duration = await metricNamed(installed, "questionnaire.session.duration");
    expect(duration?.dataPoints).toHaveLength(1);
    const completed = await metricNamed(installed, "questionnaire.sessions.completed");
    expect(completed?.dataPoints.map((point) => point.value)).toEqual([1]);
  });

  it("logs a null last item as an absent field", () => {
    const installed = install();
    emitDomainEvent({ name: "session.abandoned", sessionId: "s-1", lastItemId: null });
    expect(installed.logs()[0]).not.toHaveProperty("questionnaire.last_item_id");
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
    const answer = sensitive(CANARY);
    const log = logger("execution");

    // @ts-expect-error — a Sensitive is not a registered field's type
    log.info("answered", { sessionId: answer });
    // @ts-expect-error — nor is it accepted as a span attribute
    await withSpan("session.submit", { itemId: answer }, async () => undefined);
    // @ts-expect-error — nor as an event field
    emitDomainEvent({ name: "session.item_skipped", sessionId: answer, itemId: "itm_1", questionId: "q-1" });

    expect(await everythingExported(installed)).not.toContain(CANARY);
  });

  it("is dropped when a third-party span carries its string form", async () => {
    const installed = install();
    const answer = sensitive(CANARY);
    trace.getTracer("third-party").startSpan("GET", { attributes: { "questionnaire.item_id": String(answer) } }).end();
    expect(await everythingExported(installed)).not.toContain(CANARY);
  });

  it("serializes as [redacted] when a caller stringifies it into a permitted field", async () => {
    const installed = install();
    const answer = sensitive(CANARY);
    logger("execution").info("answered", { itemId: `${answer}` });
    expect(await everythingExported(installed)).not.toContain(CANARY);
  });
});
