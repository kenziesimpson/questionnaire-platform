import { telemetryApi } from "@qp/shared";
import { afterEach, describe, expect, it } from "vitest";
import { captureError } from "../../src/browser/errors.js";
import type { CallerAttributes, QueuedEvent } from "../../src/browser/events.js";
import { routeLogsToQueue } from "../../src/browser/logging.js";
import { createEventQueue, type EventQueue } from "../../src/browser/queue.js";
import { startBrowserTracing, stopBrowserTracing } from "../../src/browser/tracing.js";
import { toEnvelopes, toFetchInit, type WireEnvelope } from "../../src/browser/wire.js";
import { activeTraceId, emitDomainEvent, ingestBatch, logger, withSpan } from "../../src/index.js";
import { LEAK_SENTINEL } from "../../src/leak-test.js";
import { installTestTelemetry, type TestTelemetry } from "../../src/testing.js";
import { counterValueIn, ingestDropsIn } from "../faults.js";
import { QUESTION_ID, SESSION_ID } from "../fixtures.js";

const log = logger("execution");

const START = Date.parse("2026-09-19T10:00:00.000Z");

const RECEIVED_AT = START + 100_000;

const SCREEN = "/run/session";

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
  await stopBrowserTracing();
});

function fakeClock(): () => number {
  let tick = 0;
  return () => {
    tick += 1;
    return START + (tick - 1) * 1000;
  };
}

interface Browser {
  readonly queued: readonly QueuedEvent[];
  readonly traceId: string | undefined;
}

async function runBrowser(plant: (queue: EventQueue) => void | Promise<void>, screen: string = SCREEN): Promise<Browser> {
  const queued: QueuedEvent[] = [];
  const queue = createEventQueue({
    send: (events) => {
      queued.push(...events);
    },
    beacon: () => true,
    screen: () => screen,
    now: fakeClock(),
    batchSize: 1000,
    maxPending: 1000,
  });
  const stopRouting = routeLogsToQueue(queue);
  startBrowserTracing();
  let traceId: string | undefined;
  try {
    await withSpan("session.submit", { sessionId: SESSION_ID }, async () => {
      traceId = activeTraceId();
      log.info("screen shown", { sessionId: SESSION_ID, questionId: QUESTION_ID, questionType: "text" });
    });
    await plant(queue);
    queue.flush();
  } finally {
    stopRouting();
    queue.close();
    await stopBrowserTracing();
  }
  return { queued, traceId };
}

function plantLegitimate(queue: EventQueue): void {
  log.warn("request retried", { method: "POST", route: "/api/run/sessions/:sessionId" });
  log.info("page opened", {});
  captureError(queue, "error", new TypeError("cannot read"));
  log.error("submit failed", { method: "POST" }, new RangeError("out of range"));
  emitDomainEvent({ name: "session.abandoned", sessionId: SESSION_ID, lastItemId: "itm_03" });
}

function wireOf(queued: readonly QueuedEvent[]): WireEnvelope[] {
  return toEnvelopes(queued);
}

function bodiesOf(envelopes: readonly WireEnvelope[]): { events: unknown[] }[] {
  return envelopes.map((envelope) => {
    const body: { events: unknown[] } = JSON.parse(toFetchInit(envelope).body);
    return body;
  });
}

interface Ingested {
  readonly sent: number;
  readonly accepted: number;
  readonly dropped: number;
  readonly installed: TestTelemetry;
}

function ingestEnvelopes(envelopes: readonly WireEnvelope[]): Ingested {
  const installed = installTestTelemetry();
  telemetry = installed;
  const bodies = bodiesOf(envelopes);
  const receipts = bodies.map((body) => ingestBatch(body.events, RECEIVED_AT));
  return {
    sent: bodies.reduce((total, body) => total + body.events.length, 0),
    accepted: receipts.reduce((total, receipt) => total + receipt.accepted, 0),
    dropped: receipts.reduce((total, receipt) => total + receipt.dropped, 0),
    installed,
  };
}

function lineFor(installed: TestTelemetry, message: string): Record<string, unknown> | undefined {
  return installed.logs().find((line) => line.msg === message);
}

describe("the wire contract: what the SDK sends is what the ingest accepts", () => {
  it("accepts every event the SDK queued, drops none, and counts no unknown field, invalid field, unknown event, malformed event or bad trace", async () => {
    const { queued } = await runBrowser(plantLegitimate);
    const envelopes = wireOf(queued);

    const ingested = ingestEnvelopes(envelopes);

    expect(queued).toHaveLength(6);
    expect(ingested.sent).toBe(queued.length);
    expect(ingested.accepted).toBe(ingested.sent);
    expect(ingested.dropped).toBe(0);
    expect(await ingestDropsIn(ingested.installed)).toEqual({});
    expect(await ingested.installed.internalDrops()).toBe(0);
    expect(ingested.installed.logs()).toHaveLength(queued.length);
  });

  it("carries a client.error from a real Error: its class and frames, none of its message", async () => {
    const { queued } = await runBrowser(plantLegitimate);

    const { installed } = ingestEnvelopes(wireOf(queued));

    const errors = installed.logs().filter((line) => line.msg === "client.error");
    expect(errors).toHaveLength(2);
    expect(errors.map((line) => line["error.type"]).sort()).toEqual(["RangeError", "TypeError"]);
    for (const line of errors) {
      expect(line).toMatchObject({ level: "error", module: "browser", "telemetry.source": "browser" });
      expect(line["error.stack"]).toMatch(/^ {4}at /);
    }
    expect(JSON.stringify(installed.logs())).not.toContain("cannot read");
    expect(JSON.stringify(installed.logs())).not.toContain("out of range");
  });

  it("carries client.info and client.warn with the route an event names, or else the screen, and the level its name carries", async () => {
    const { queued } = await runBrowser(plantLegitimate);

    const { installed } = ingestEnvelopes(wireOf(queued));

    expect(lineFor(installed, "client.warn")).toMatchObject({
      level: "warn",
      "http.request.method": "POST",
      "http.route": "/api/run/sessions/:sessionId",
    });
    const infos = installed.logs().filter((line) => line.msg === "client.info");
    expect(infos.map((line) => line["http.route"])).toEqual([SCREEN, SCREEN]);
    expect(infos[0]).toMatchObject({
      level: "info",
      "questionnaire.session_id": SESSION_ID,
      "questionnaire.question_id": QUESTION_ID,
      "questionnaire.question_type": "text",
    });
  });

  it("carries session.abandoned as a domain event with its last item, through the event log and its counter", async () => {
    const { queued } = await runBrowser(plantLegitimate);
    const [first] = wireOf(queued);

    const { installed } = ingestEnvelopes(wireOf(queued));

    expect(first?.events[0]).toMatchObject({ name: "session.abandoned", fields: { sessionId: SESSION_ID, lastItemId: "itm_03" } });
    expect(lineFor(installed, "session.abandoned")).toMatchObject({
      level: "info",
      module: "events",
      "questionnaire.session_id": SESSION_ID,
      "questionnaire.last_item_id": "itm_03",
      "telemetry.source": "browser",
    });
    expect(await counterValueIn(installed, "questionnaire.sessions.abandoned")).toBe(1);
  });

  it("gives the log line the browser's trace and span, and gives an event sent outside a span none", async () => {
    const { queued, traceId } = await runBrowser(plantLegitimate);
    const inSpan = queued.find((event) => event.traceparent !== undefined);
    const spanId = inSpan?.traceparent?.split("-")[2];

    const { installed } = ingestEnvelopes(wireOf(queued));

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(queued.filter((event) => event.traceparent !== undefined)).toHaveLength(1);
    const traced = installed.logs().filter((line) => "trace_id" in line);
    expect(traced).toHaveLength(1);
    expect(traced[0]).toMatchObject({ msg: "client.info", trace_id: traceId, span_id: spanId });
  });

  it("stamps each event when it was queued, so the ingest sees its age at the receipt", async () => {
    const { queued } = await runBrowser(plantLegitimate);

    const { installed } = ingestEnvelopes(wireOf(queued));

    expect(lineFor(installed, "session.abandoned")).toMatchObject({ "telemetry.event_age_ms": 100_000 - 5000 });
    expect(lineFor(installed, "client.warn")).toMatchObject({ "telemetry.event_age_ms": 100_000 - 1000 });
  });

  it("splits more events than an envelope may hold into several envelopes, all accepted, the abandonment first", async () => {
    const { queued } = await runBrowser(() => {
      for (let count = 0; count < telemetryApi.MAX_TELEMETRY_EVENTS * 2 + 30; count += 1) log.info("tick", {});
      emitDomainEvent({ name: "session.abandoned", sessionId: SESSION_ID, lastItemId: null });
    });
    const envelopes = wireOf(queued);

    const ingested = ingestEnvelopes(envelopes);

    expect(envelopes).toHaveLength(3);
    expect(envelopes.map((envelope) => envelope.events.length)).toEqual([50, 50, 32]);
    expect(envelopes[0]?.events[0]?.name).toBe("session.abandoned");
    expect(ingested.sent).toBe(queued.length);
    expect(ingested.accepted).toBe(queued.length);
    expect(ingested.dropped).toBe(0);
    expect(await ingestDropsIn(ingested.installed)).toEqual({});
  });

  it("splits events whose bytes exceed the body cap into several envelopes, each under the cap, all accepted", async () => {
    const frames = (index: number): string =>
      Array.from({ length: 40 }, (_, frame) => `    at ${"f".repeat(90)}${index}x${frame} (chunk-${"a".repeat(50)}.js:1:2)`).join("\n");
    const { queued } = await runBrowser((queue) => {
      for (let index = 0; index < 20; index += 1) {
        queue.enqueueRecord({ level: "error", message: "unhandled error", attributes: { "error.type": "Error", "error.stack": frames(index) } });
      }
    });
    const envelopes = wireOf(queued);

    const ingested = ingestEnvelopes(envelopes);

    expect(envelopes.length).toBeGreaterThan(2);
    for (const envelope of envelopes) {
      expect(Buffer.byteLength(JSON.stringify(envelope), "utf8")).toBeLessThanOrEqual(telemetryApi.MAX_TELEMETRY_BODY_BYTES);
    }
    expect(ingested.sent).toBe(queued.length);
    expect(ingested.accepted).toBe(queued.length);
    expect(ingested.dropped).toBe(0);
    expect(await ingestDropsIn(ingested.installed)).toEqual({});
  });
});

describe("the wire contract: a planted answer never leaves the browser", () => {
  function plantSentinel(queue: EventQueue): void {
    const sentinel = LEAK_SENTINEL;
    const forged = { answer: sentinel, sessionId: sentinel, itemId: sentinel, questionId: sentinel, route: `/run/${sentinel}` };
    log.info("answer received", { ...forged });
    log.error("submit failed", { status: 500 }, new Error(sentinel));
    emitDomainEvent({ name: "session.abandoned", sessionId: sentinel, lastItemId: sentinel });
    emitDomainEvent({ name: "session.abandoned", sessionId: SESSION_ID, lastItemId: "itm_03" });
    const named = new Error(sentinel);
    named.name = sentinel;
    named.stack = `${sentinel}: ${sentinel}\n    at ${sentinel} (https://example.test/run/${sentinel}/main.js:1:2)\n${sentinel}`;
    captureError(queue, "error", named);
    captureError(queue, "rejection", { message: sentinel, answer: sentinel });
    queue.enqueueRecord({ level: "info", message: sentinel.toLowerCase(), attributes: {} });
    queue.enqueueRecord({
      level: "error",
      message: `answer ${sentinel}`,
      attributes: {
        "error.type": sentinel,
        "error.stack": `    at ${sentinel} (${sentinel}.js:1:1)\n${sentinel}`,
        "questionnaire.session_id": sentinel,
        "questionnaire.last_item_id": sentinel,
        "http.route": `/${sentinel}`,
        "url.full": `https://example.test/run/${sentinel}`,
        "telemetry.source": sentinel,
        answer: sentinel,
      },
    });
  }

  it("keeps the sentinel out of every envelope, whichever way it is encoded, and out of every log line the ingest writes", async () => {
    const { queued } = await runBrowser(plantSentinel, `/run/${LEAK_SENTINEL}`);
    const envelopes = wireOf(queued);

    const ingested = ingestEnvelopes(envelopes);

    expect(ingested.accepted, "the plants must have produced events for this test to prove anything").toBeGreaterThan(5);
    for (const envelope of envelopes) {
      const encoded = JSON.stringify(envelope).toLowerCase();
      expect(encoded).not.toContain(LEAK_SENTINEL.toLowerCase());
      expect(toFetchInit(envelope).body.toLowerCase()).not.toContain(LEAK_SENTINEL.toLowerCase());
    }
    expect(JSON.stringify(ingested.installed.logs()).toLowerCase()).not.toContain(LEAK_SENTINEL.toLowerCase());
    expect(ingested.installed.logs().some((line) => line["questionnaire.session_id"] === SESSION_ID)).toBe(true);
  });

  it("is checked by an assertion that can fail: an envelope carrying the sentinel is flagged", () => {
    const leaking: WireEnvelope = {
      events: [{ name: "client.info", at: "2026-09-19T10:00:00.000Z", fields: { itemId: LEAK_SENTINEL.toLowerCase() } }],
    };

    expect(JSON.stringify(leaking).toLowerCase()).toContain(LEAK_SENTINEL.toLowerCase());
  });
});

describe("the wire contract: negative controls", () => {
  it("names session.abandoned only for the record emitDomainEvent wrote, never for a forged module or a logger call from app code", async () => {
    const forgedAttributes: CallerAttributes = JSON.parse('{"module":"events"}');
    const { queued } = await runBrowser((queue) => {
      queue.enqueue({ level: "info", message: "session.abandoned", attributes: forgedAttributes });
      queue.enqueueRecord({ level: "info", message: "session.abandoned", attributes: { module: "events" } });
      logger("events").info("session.abandoned", { sessionId: SESSION_ID, lastItemId: "itm_03" });
      emitDomainEvent({ name: "session.abandoned", sessionId: SESSION_ID, lastItemId: "itm_04" });
    });
    const envelopes = wireOf(queued);

    const ingested = ingestEnvelopes(envelopes);

    const names = envelopes.flatMap((envelope) => envelope.events.map((event) => event.name));
    expect(queued.filter((event) => event.message === "session.abandoned")).toHaveLength(4);
    expect(names.filter((name) => name === "session.abandoned")).toHaveLength(1);
    expect(names.filter((name) => name === "client.info")).toHaveLength(4);
    expect(ingested.accepted).toBe(queued.length);
    expect(await counterValueIn(ingested.installed, "questionnaire.sessions.abandoned")).toBe(1);
    expect(lineFor(ingested.installed, "session.abandoned")).toMatchObject({ "questionnaire.last_item_id": "itm_04" });
  });

  it("negative control: a lower-case, route-shaped screen name IS sent, since the route check is a shape check only", async () => {
    const { queued } = await runBrowser(() => undefined, `/run/${LEAK_SENTINEL.toLowerCase()}`);
    const envelopes = wireOf(queued);

    const ingested = ingestEnvelopes(envelopes);

    expect(JSON.stringify(envelopes).toLowerCase()).toContain(LEAK_SENTINEL.toLowerCase());
    expect(ingested.dropped).toBe(0);
    expect(JSON.stringify(ingested.installed.logs()).toLowerCase()).toContain(LEAK_SENTINEL.toLowerCase());
  });
});
