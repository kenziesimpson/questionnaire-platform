import { sensitive } from "@qp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureError, installErrorCapture } from "../../src/browser/errors.js";
import type { QueuedEvent } from "../../src/browser/events.js";
import { flushOnPageHide } from "../../src/browser/lifecycle.js";
import { routeLogsToQueue } from "../../src/browser/logging.js";
import { createEventQueue } from "../../src/browser/queue.js";
import { startBrowserTelemetry } from "../../src/browser/start.js";
import { injectTraceHeaders, type HeadersInput } from "../../src/browser/trace-headers.js";
import { startBrowserTracing, stopBrowserTracing } from "../../src/browser/tracing.js";
import { createTransport } from "../../src/browser/transport.js";
import { emitDomainEvent, logger, withSpan } from "../../src/index.js";
import { expectCleanRun, LEAK_SENTINEL, runLeakFlow, type LeakFlow } from "../../src/leak-test.js";
import { SESSION_ID } from "../fixtures.js";
import { FakeWindow } from "./page-fakes.js";

const log = logger("execution");

type Exit = "send" | "beacon";

interface Delivery {
  readonly sent: readonly QueuedEvent[];
  readonly beaconed: readonly QueuedEvent[];
}

function carries(value: unknown, sentinel: string): boolean {
  return JSON.stringify(value).toLowerCase().includes(sentinel.toLowerCase());
}

function stackWith(error: Error, stack: string): Error {
  error.stack = stack;
  return error;
}

function plantThroughLogger(sentinel: string): void {
  const forged = { answer: sentinel, sessionId: sentinel, itemId: sentinel, route: `/run/${sentinel}` };
  log.info("answer received", { ...forged });
  log.error("submit failed", { status: 500 }, new Error(sentinel));
  emitDomainEvent({ name: "session.abandoned", sessionId: sentinel, lastItemId: sentinel });
  emitDomainEvent({ name: "session.item_skipped", sessionId: sentinel, itemId: sentinel, questionId: sentinel });
  emitDomainEvent({ name: "page.loaded", route: `/q/${sentinel}`, durationMs: Number.NaN });
  emitDomainEvent({ name: "page.loaded", route: sentinel, durationMs: 850 });
}

function plantEverywhere(page: FakeWindow, enqueue: (level: string, message: unknown, attributes: unknown) => void, sentinel: string): void {
  enqueue("info", "answer received", {
    answer: sentinel,
    value: sentinel,
    "http.request.body": sentinel,
    "url.full": `https://example.test/run/${sentinel}?answer=${sentinel}`,
  });
  enqueue("info", "answer received", {
    "questionnaire.session_id": sentinel,
    "questionnaire.item_id": sentinel,
    "questionnaire.last_item_id": sentinel,
    "questionnaire.question_id": sentinel,
    "questionnaire.outcome": sentinel,
    "questionnaire.reason": sentinel,
    "http.route": `/${sentinel}`,
    "error.type": sentinel,
    "error.code": sentinel,
    "error.stack": `    at ${sentinel} (${sentinel}.js:1:1)\n${sentinel}`,
    module: sentinel,
  });
  enqueue("info", "answer received", { "questionnaire.item_id": sensitive(sentinel), "questionnaire.session_id": { nested: sentinel } });
  enqueue("warn", sentinel, { "questionnaire.session_id": SESSION_ID });
  enqueue("error", `answer ${sentinel}`, {});
  enqueue("info", { toString: () => "answer received", answer: sentinel }, {});
  enqueue("info", "answer received", { "error.stack": `    at render (https://example.test/run/${sentinel}/answers?cursor=${sentinel}:1:2)` });
  plantThroughLogger(sentinel);

  page.dispatch("error", {
    error: stackWith(new TypeError(`cannot read ${sentinel}`), `TypeError: cannot read ${sentinel}\n    at render (https://example.test/run/${sentinel}:1:2)`),
    message: `Uncaught TypeError: cannot read ${sentinel}`,
    filename: `https://example.test/run/${sentinel}`,
  });
  page.dispatch("error", { error: stackWith(new Error("boom"), `Error: boom\n    at Object.${sentinel} (main.js:1:2)`) });
  page.dispatch("error", { error: stackWith(new Error("innocent"), `Error: ${sentinel}\n    at render (main.js:1:2)`) });
  page.dispatch("error", { error: stackWith(new Error("boom"), `Error: boom\n    at render (main.js:1:2)\n${sentinel}\n${sentinel}: ${sentinel}`) });
  const multiLine = `first\n    at ${sentinel} (${sentinel}.js:1:1)`;
  page.dispatch("error", { error: stackWith(new Error(multiLine), `Error: ${multiLine}\n    at render (main.js:1:2)`) });
  const namedForTheAnswer = new Error(sentinel);
  namedForTheAnswer.name = sentinel;
  page.dispatch("error", { error: namedForTheAnswer });
  page.dispatch("unhandledrejection", { reason: sentinel });
  page.dispatch("unhandledrejection", { reason: { message: sentinel, answer: sentinel } });
  page.dispatch("unhandledrejection", { reason: stackWith(new RangeError(sentinel), `RangeError: ${sentinel}\n    at render (main.js:1:2)`) });
}

function run(sentinel: string, exit: Exit): Delivery {
  const page = new FakeWindow();
  const sent: QueuedEvent[] = [];
  const beaconed: QueuedEvent[] = [];
  const queue = createEventQueue({
    send: (events) => {
      sent.push(...events);
    },
    beacon: (events) => {
      beaconed.push(...events);
      return true;
    },
    screen: () => `/run/${sentinel}`,
    batchSize: 1000,
    maxPending: 1000,
  });
  const removers = [routeLogsToQueue(queue), installErrorCapture(queue, page), flushOnPageHide(queue, page)];
  try {
    plantEverywhere(
      page,
      (level, message, attributes) => {
        queue.enqueueRecord({ level, message, attributes });
      },
      sentinel,
    );
    if (exit === "send") queue.flush();
    else page.dispatch("pagehide");
  } finally {
    for (const remove of removers) remove();
  }
  return { sent, beaconed };
}

interface WireBytes {
  readonly posted: readonly string[];
  readonly beaconed: readonly string[];
}

async function bytesOnTheWire(sentinel: string, exit: Exit): Promise<WireBytes> {
  const page = new FakeWindow();
  const posted: string[] = [];
  const blobs: Blob[] = [];
  const queue = createEventQueue({
    ...createTransport({
      url: "/api/telemetry",
      fetch: (_url, init) => {
        posted.push(init.body);
        return Promise.resolve({ ok: true });
      },
      sendBeacon: (_url, blob) => {
        blobs.push(blob);
        return blob.type === "application/json";
      },
    }),
    screen: () => `/run/${sentinel}`,
    batchSize: 1000,
    maxPending: 1000,
  });
  const removers = [routeLogsToQueue(queue), installErrorCapture(queue, page), flushOnPageHide(queue, page)];
  try {
    plantEverywhere(
      page,
      (level, message, attributes) => {
        queue.enqueueRecord({ level, message, attributes });
      },
      sentinel,
    );
    if (exit === "send") queue.flush();
    else page.dispatch("pagehide");
    await settled();
  } finally {
    for (const remove of removers) remove();
  }
  return { posted, beaconed: await Promise.all(blobs.map((blob) => blob.text())) };
}

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function lowerCasedTokenQueued(): readonly QueuedEvent[] {
  const sent: QueuedEvent[] = [];
  const queue = createEventQueue({
    send: (events) => {
      sent.push(...events);
    },
    beacon: () => true,
    screen: () => `/${LEAK_SENTINEL.toLowerCase()}`,
  });
  queue.enqueueRecord({ level: "info", message: LEAK_SENTINEL.toLowerCase(), attributes: {} });
  queue.flush();
  return sent;
}

afterEach(async () => {
  await stopBrowserTracing();
});

describe("the browser telemetry never lets a planted answer reach the batch, the beacon or an exception", () => {
  it.each([
    ["the sent batch", "send", "sent"],
    ["the beacon", "beacon", "beaconed"],
  ] as const)("keeps the sentinel out of %s, in every field, message, stack and screen", (_where, exit, reached) => {
    const events = run(LEAK_SENTINEL, exit)[reached];

    expect(events.length, "the plants must have produced events for this test to prove anything").toBeGreaterThan(10);
    expect(carries(events, LEAK_SENTINEL)).toBe(false);
    expect(events.some((event) => event.attributes["questionnaire.session_id"] === SESSION_ID)).toBe(true);
  });

  it("delivers the legitimate events beside the planted ones with their own fields intact", () => {
    const events = run(LEAK_SENTINEL, "send").sent;

    expect(events).toContainEqual({ level: "warn", at: expect.any(String), message: "unnamed", attributes: { "questionnaire.session_id": SESSION_ID } });
    expect(events).toContainEqual({
      level: "error",
      at: expect.any(String),
      message: "unhandled error",
      attributes: { "error.type": "Error", "error.stack": "    at render (main.js:1:2)" },
    });
  });

  it("cuts a caller-supplied error stack, a function name and a disguised message to their safe forms", () => {
    const events = run(LEAK_SENTINEL, "send").sent;

    expect(events).toContainEqual({ level: "info", at: expect.any(String), message: "answer received", attributes: { "error.stack": "    at render (anonymous.js:1:2)" } });
    expect(events).toContainEqual({
      level: "error",
      at: expect.any(String),
      message: "unhandled error",
      attributes: { "error.type": "Error", "error.stack": "    at anonymous (main.js:1:2)" },
    });
    expect(events).toContainEqual({ level: "info", at: expect.any(String), message: "unnamed", attributes: {} });
  });

  it.each([
    ["the sent envelopes", "send", "posted"],
    ["the beacon bodies", "beacon", "beaconed"],
  ] as const)("keeps the sentinel out of the bytes of %s, the encoding the ingest reads", async (_where, exit, reached) => {
    const bodies = (await bytesOnTheWire(LEAK_SENTINEL, exit))[reached];

    expect(bodies.length, "the plants must have produced bodies for this test to prove anything").toBeGreaterThan(0);
    expect(carries(bodies, LEAK_SENTINEL)).toBe(false);
    expect(bodies.some((body) => body.includes(SESSION_ID))).toBe(true);
  });

  it("negative control: the wire check flags a body that does carry the sentinel", () => {
    expect(carries([JSON.stringify({ events: [{ name: "client.info", at: "x", fields: { itemId: LEAK_SENTINEL.toLowerCase() } }] })], LEAK_SENTINEL)).toBe(true);
  });

  it.each([
    ["a record", (): HeadersInput => ({ accept: "application/json" })],
    ["a Headers object", (): HeadersInput => new Headers({ accept: "application/json" })],
    ["an array of pairs", (): HeadersInput => [["accept", "application/json"]]],
  ])("keeps the sentinel out of the trace headers built from %s", async (_shape, input) => {
    startBrowserTracing();
    let headers: Record<string, string> = {};

    await withSpan("browser.request", { sessionId: LEAK_SENTINEL, route: `/run/${LEAK_SENTINEL}` }, async () => {
      headers = injectTraceHeaders(input());
    });

    expect(Object.keys(headers).sort()).toEqual(["accept", "traceparent"]);
    expect(carries(headers, LEAK_SENTINEL)).toBe(false);
  });

  it("drops the forged route of a page load from the wire, keeps its duration, and keeps a real route", async () => {
    const posted: string[] = [];
    const queue = createEventQueue({
      ...createTransport({
        url: "/api/telemetry",
        fetch: (_url, init) => {
          posted.push(init.body);
          return Promise.resolve({ ok: true });
        },
        sendBeacon: () => true,
      }),
    });
    const stopRouting = routeLogsToQueue(queue);
    emitDomainEvent({ name: "page.loaded", route: `/q/${LEAK_SENTINEL}`, durationMs: 850 });
    emitDomainEvent({ name: "page.loaded", route: "/q/:questionnaireId", durationMs: 900 });
    stopRouting();
    queue.flush();
    await settled();

    expect(carries(posted, LEAK_SENTINEL)).toBe(false);
    expect(JSON.parse(posted[0] ?? "{}").events).toEqual([
      { name: "page.loaded", at: expect.any(String), fields: { durationMs: 850 } },
      { name: "page.loaded", at: expect.any(String), fields: { route: "/q/:questionnaireId", durationMs: 900 } },
    ]);
  });

  it("never lets an exception carrying the sentinel out of a capture", () => {
    const failing = {
      enqueueRecord: vi.fn(() => {
        throw new Error(LEAK_SENTINEL);
      }),
    };

    expect(() => {
      captureError(failing, "error", new Error(LEAK_SENTINEL));
    }).not.toThrow();
  });

  it("is checked by an assertion that can fail: a batch that does carry the sentinel is flagged", () => {
    const leaked: QueuedEvent[] = [{ level: "info", at: "2026-01-01T00:00:00.000Z", message: "answer received", attributes: { "questionnaire.item_id": LEAK_SENTINEL.toLowerCase() } }];

    expect(carries(leaked, LEAK_SENTINEL)).toBe(true);
  });

  it("negative control: a lower-case, message-shaped token IS queued, since the message and route checks are shape checks only", () => {
    expect(carries(lowerCasedTokenQueued(), LEAK_SENTINEL)).toBe(true);
  });
});

describe("the browser flow, run through the leak-test runner beside the real pipeline", () => {
  it("leaves the sentinel out of every exporter and out of the queue, and is not vacuous", async () => {
    const flow: LeakFlow<undefined> = {
      name: "browser: forged fields, messages, stacks, screens, page loads and domain events through the queue and onto the wire",
      run: async (_world, sentinel) => {
        plantThroughLogger(sentinel);
        expect(carries(run(sentinel, "send"), sentinel)).toBe(false);
        expect(carries(await bytesOnTheWire(sentinel, "beacon"), sentinel)).toBe(false);
      },
    };

    const result = await runLeakFlow(flow, undefined);

    expectCleanRun(flow.name, result);
    expect(result.observed.metric).toBeGreaterThan(0);
    expect(result.observed.log, "the logger plants run before the queue takes the log sink over, so pino output is checked too").toBeGreaterThan(0);
  });
});
