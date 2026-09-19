import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedEvent } from "../../src/browser/events.js";
import { createEventQueue, type EventQueueOptions } from "../../src/browser/queue.js";
import { SESSION_ID } from "../fixtures.js";

const LEAK = "LEAK_DIABETES_8F3A";

const ROUTE = "/questionnaires/$questionnaireId/responses/$sessionId";

function queueWith(overrides: Partial<EventQueueOptions> = {}) {
  const batches: (readonly QueuedEvent[])[] = [];
  const beacons: (readonly QueuedEvent[])[] = [];
  const queue = createEventQueue({
    send: (events) => {
      batches.push(events);
    },
    beacon: (events) => {
      beacons.push(events);
      return true;
    },
    ...overrides,
  });
  return { queue, batches, beacons };
}

function info(message: string, attributes: unknown = {}) {
  return { level: "info", message, attributes };
}

function messagesOf(batches: readonly (readonly QueuedEvent[])[]): string[] {
  return batches.flat().map((event) => event.message);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createEventQueue: what is queued", () => {
  it("keeps registered fields under their attribute names and the infrastructure attributes", () => {
    const { queue, batches } = queueWith();

    queue.enqueueRecord(info("session abandoned", { "questionnaire.session_id": SESSION_ID, "questionnaire.last_item_id": "itm_03", module: "events" }));
    queue.flush();

    expect(batches).toEqual([
      [
        {
          level: "info",
          message: "session abandoned",
          attributes: { "questionnaire.session_id": SESSION_ID, "questionnaire.last_item_id": "itm_03", module: "events" },
        },
      ],
    ]);
  });

  it("drops an unknown field and a field of the wrong shape, never the event, and counts them", () => {
    const { queue, batches } = queueWith();

    queue.enqueueRecord(
      info("answer received", {
        "questionnaire.session_id": SESSION_ID,
        answer: LEAK,
        "http.request.body": LEAK,
        "questionnaire.item_id": `free text ${LEAK}`,
      }),
    );
    queue.flush();

    expect(batches[0]?.[0]?.attributes).toEqual({ "questionnaire.session_id": SESSION_ID });
    expect(queue.stats().droppedFields).toEqual({ unknown: 2, invalid: 1, unbounded: 0, internal: 0 });
  });

  it.each([
    ["a string", LEAK],
    ["null", null],
    ["undefined", undefined],
    ["a number", 7],
  ])("keeps the event when its attributes are %s", (_kind, attributes) => {
    const { queue, batches } = queueWith();

    queue.enqueueRecord(info("session abandoned", attributes));
    queue.flush();

    expect(batches[0]?.[0]?.attributes).toEqual({});
  });

  it("drops the indexes of an array given as attributes", () => {
    const { queue, batches } = queueWith();

    queue.enqueueRecord(info("session abandoned", [LEAK]));
    queue.flush();

    expect(batches[0]?.[0]?.attributes).toEqual({});
    expect(queue.stats().droppedFields.unknown).toBe(1);
  });

  it("replaces a message that is not literal-shaped with a fixed name and counts it", () => {
    const { queue, batches } = queueWith();

    for (const message of [LEAK, "Rejected answer: Diabetes", "", `a${"b".repeat(200)}`, "line\nbreak"]) {
      queue.enqueueRecord(info(message));
    }
    queue.flush();

    expect(messagesOf(batches)).toEqual(["unnamed", "unnamed", "unnamed", "unnamed", "unnamed"]);
    expect(queue.stats().droppedFields.invalid).toBe(5);
  });

  it("never queues debug, or a level that does not exist", () => {
    const { queue, batches } = queueWith();

    queue.enqueueRecord({ level: "debug", message: "rule evaluated", attributes: {} });
    queue.enqueueRecord({ level: "fatal", message: "boom", attributes: {} });
    queue.flush();

    expect(batches).toEqual([]);
    expect(queue.stats().pending).toBe(0);
    expect(queue.stats().droppedEvents.level).toBe(2);
  });

  it("queues only a string that has the shape of a message, never an object that stringifies to one", () => {
    const { queue, batches } = queueWith();
    const disguised = { toString: () => "answer received", leak: LEAK };

    queue.enqueueRecord({ level: "info", message: disguised, attributes: {} });
    queue.enqueueRecord({ level: "info", message: 7, attributes: {} });
    queue.flush();

    expect(messagesOf(batches)).toEqual(["unnamed", "unnamed"]);
    expect(JSON.stringify(batches)).not.toContain(LEAK);
  });

  it("cuts the frames of a stack a caller supplied to script files and safe function names", () => {
    const { queue, batches } = queueWith();
    const stack = [
      `    at render (https://example.test/run/${SESSION_ID}/step?cursor=abc.js:1:2)`,
      `    at Object.${LEAK} (main.js:3:4)`,
      "    at Array.map (main.js?next=/run/x:5:6)",
      "    at async Promise.all (<anonymous>)",
    ].join("\n");

    queue.enqueueRecord(info("session abandoned", { "error.stack": stack }));
    queue.flush();

    expect(batches[0]?.[0]?.attributes["error.stack"]).toBe(
      ["    at render (anonymous.js:1:2)", "    at anonymous (main.js:3:4)", "    at Array.map (main.js:5:6)", "    at async Promise.all (<anonymous>)"].join("\n"),
    );
  });

  it("drops an error stack that is not made of frames, and one that is not a string", () => {
    const { queue, batches } = queueWith();

    queue.enqueueRecord(info("session abandoned", { "error.stack": `    at go (main.js:1:2)\n${LEAK}` }));
    queue.enqueueRecord(info("session abandoned", { "error.stack": { text: LEAK } }));
    queue.flush();

    expect(batches[0]?.map((event) => event.attributes)).toEqual([{}, {}]);
    expect(queue.stats().droppedFields.invalid).toBe(2);
  });

  it("never throws into the caller, even for input that throws when read", () => {
    const { queue } = queueWith();
    const hostile = {
      get boom(): string {
        throw new Error(LEAK);
      },
    };

    expect(() => {
      queue.enqueueRecord(info("session abandoned", hostile));
    }).not.toThrow();
    expect(queue.stats().droppedEvents.internal).toBe(1);
    expect(queue.stats().pending).toBe(0);
  });
});

describe("createEventQueue: enqueue, the form for app code", () => {
  it("takes a literal message and attributes that do not name the error stack", () => {
    const { queue, batches } = queueWith();

    queue.enqueue({ level: "info", message: "session abandoned", attributes: { "questionnaire.session_id": SESSION_ID } });
    queue.flush();

    expect(batches[0]).toEqual([
      { level: "info", message: "session abandoned", attributes: { "questionnaire.session_id": SESSION_ID } },
    ]);
  });

  it("refuses a message held in a string variable and an error stack at compile time", () => {
    const { queue } = queueWith();
    const text: string = LEAK;

    // @ts-expect-error — a message must be a literal, not a string variable
    queue.enqueue({ level: "info", message: text });
    // @ts-expect-error — a caller cannot name the error stack
    queue.enqueue({ level: "info", message: "session abandoned", attributes: { "error.stack": "    at go (main.js:1:2)" } });
    // @ts-expect-error — debug is never queued
    queue.enqueue({ level: "debug", message: "rule evaluated" });

    expect(queue.stats().droppedEvents.level).toBe(1);
  });
});

describe("createEventQueue: the screen", () => {
  it("stamps the caller's route template as the route", () => {
    const { queue, batches } = queueWith({ screen: () => ROUTE });

    queue.enqueueRecord(info("session abandoned"));
    queue.flush();

    expect(batches[0]?.[0]?.attributes).toEqual({ "http.route": ROUTE });
  });

  it.each([
    ["a URL with a query string", `${ROUTE}?cursor=abc`],
    ["a full URL", `https://example.test/questionnaires/${SESSION_ID}`],
    ["a path holding an upper-case token", `/run/${LEAK}`],
    ["a path holding an upper-case id", `/run/${SESSION_ID.toUpperCase()}/answers`],
    ["free text", `answers for ${LEAK}`],
    ["an empty string", ""],
  ])("drops %s as a screen and keeps the event", (_kind, screen) => {
    const { queue, batches } = queueWith({ screen: () => screen });

    queue.enqueueRecord(info("session abandoned", { "questionnaire.session_id": SESSION_ID }));
    queue.flush();

    expect(batches[0]?.[0]?.attributes).toEqual({ "questionnaire.session_id": SESSION_ID });
    expect(queue.stats().droppedFields.invalid).toBe(1);
  });

  it("keeps the route an event already carries over the queue's screen", () => {
    const { queue, batches } = queueWith({ screen: () => "/other" });

    queue.enqueueRecord(info("session abandoned", { "http.route": "/questionnaires" }));
    queue.flush();

    expect(batches[0]?.[0]?.attributes).toEqual({ "http.route": "/questionnaires" });
  });

  it("keeps the event when the screen provider throws", () => {
    const { queue, batches } = queueWith({
      screen: () => {
        throw new Error(LEAK);
      },
    });

    queue.enqueueRecord(info("session abandoned"));
    queue.flush();

    expect(batches[0]).toHaveLength(1);
  });
});

describe("createEventQueue: flushing", () => {
  it("sends a batch as soon as the batch size is reached", () => {
    const { queue, batches } = queueWith({ batchSize: 3 });

    queue.enqueueRecord(info("event 1"));
    queue.enqueueRecord(info("event 2"));
    expect(batches).toEqual([]);
    queue.enqueueRecord(info("event 3"));

    expect(messagesOf(batches)).toEqual(["event 1", "event 2", "event 3"]);
    expect(batches).toHaveLength(1);
  });

  it("sends what is queued once the interval has passed since the first event", () => {
    const { queue, batches } = queueWith({ flushIntervalMs: 1000 });

    queue.enqueueRecord(info("event 1"));
    vi.advanceTimersByTime(999);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(messagesOf(batches)).toEqual(["event 1"]);
  });

  it("sends nothing when the queue is empty", () => {
    const { queue, batches } = queueWith({ flushIntervalMs: 1000 });

    queue.flush();
    vi.advanceTimersByTime(5000);

    expect(batches).toEqual([]);
  });

  it("falls back to the defaults for a size or interval that is not a positive integer, and never batches past the bound", () => {
    const zero = queueWith({ batchSize: 0, maxPending: Number.NaN, flushIntervalMs: -1 });
    for (let index = 0; index < 19; index += 1) zero.queue.enqueueRecord(info("event"));
    expect(zero.batches).toEqual([]);
    zero.queue.enqueueRecord(info("event"));
    expect(zero.batches[0]).toHaveLength(20);

    const clamped = queueWith({ maxPending: 3, batchSize: 10 });
    for (let index = 0; index < 3; index += 1) clamped.queue.enqueueRecord(info("event"));
    expect(clamped.batches[0]).toHaveLength(3);
  });

  it("has one send in flight at a time and sends the next batch when the first settles", async () => {
    const releases: (() => void)[] = [];
    const sends: (readonly QueuedEvent[])[] = [];
    const { queue } = queueWith({
      batchSize: 2,
      send: (events) => {
        sends.push(events);
        return new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      },
    });

    for (let index = 1; index <= 4; index += 1) queue.enqueueRecord(info(`event ${String(index)}`));
    expect(sends).toHaveLength(1);
    expect(queue.stats().pending).toBe(2);

    releases[0]?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(sends).toHaveLength(2);
    expect(messagesOf(sends)).toEqual(["event 1", "event 2", "event 3", "event 4"]);
    expect(queue.stats().sent).toBe(2);
  });

  it("counts a batch as undelivered when send rejects, and carries on", async () => {
    let calls = 0;
    const { queue } = queueWith({
      batchSize: 1,
      send: () => {
        calls += 1;
        return Promise.reject(new Error(LEAK));
      },
    });

    queue.enqueueRecord(info("event 1"));
    await vi.advanceTimersByTimeAsync(0);
    queue.enqueueRecord(info("event 2"));
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toBe(2);
    expect(queue.stats().droppedEvents.undelivered).toBe(2);
    expect(queue.stats().sent).toBe(0);
  });

  it("counts a batch as undelivered when send throws, without throwing into the caller", () => {
    const { queue } = queueWith({
      batchSize: 1,
      send: () => {
        throw new Error(LEAK);
      },
    });

    expect(() => {
      queue.enqueueRecord(info("event 1"));
    }).not.toThrow();
    expect(queue.stats().droppedEvents.undelivered).toBe(1);
  });
});

describe("createEventQueue: the bound", () => {
  it("holds at most maxPending events and drops the oldest, counting each", () => {
    const { queue, beacons } = queueWith({ maxPending: 5, batchSize: 2, send: () => new Promise<void>(() => undefined) });

    for (let index = 1; index <= 10; index += 1) queue.enqueueRecord(info(`event ${String(index)}`));

    expect(queue.stats().pending).toBe(5);
    expect(queue.stats().droppedEvents.overflow).toBe(3);

    queue.flushOnExit();

    expect(messagesOf(beacons)).toEqual(["event 6", "event 7", "event 8", "event 9", "event 10"]);
  });

  it("does not count an event as dropped when it fits", () => {
    const { queue } = queueWith({ maxPending: 5, batchSize: 5 });

    for (let index = 1; index <= 5; index += 1) queue.enqueueRecord(info(`event ${String(index)}`));

    expect(queue.stats().droppedEvents).toEqual({ overflow: 0, undelivered: 0, internal: 0, level: 0 });
  });
});

describe("createEventQueue: close", () => {
  it("stops the timer and never sends again, even when a send that was in flight settles afterwards", async () => {
    const releases: (() => void)[] = [];
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const { queue, beacons } = queueWith({ batchSize: 2, flushIntervalMs: 1000, send });

    for (let index = 1; index <= 4; index += 1) queue.enqueueRecord(info(`event ${String(index)}`));
    queue.flushOnExit();
    queue.close();
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(messagesOf(beacons)).toEqual(["event 3", "event 4"]);
  });

  it("ignores events and flushes once closed", () => {
    const { queue, batches } = queueWith({ batchSize: 1 });

    queue.close();
    queue.enqueueRecord(info("event 1"));
    queue.flush();

    expect(batches).toEqual([]);
    expect(queue.stats().pending).toBe(0);
  });
});

describe("createEventQueue: flushOnExit", () => {
  it("hands everything left to the beacon in batches, not to send, and empties the queue", () => {
    const send = vi.fn(() => new Promise<void>(() => undefined));
    const { queue, beacons } = queueWith({ batchSize: 2, send });

    for (let index = 1; index <= 5; index += 1) queue.enqueueRecord(info(`event ${String(index)}`));
    queue.flushOnExit();

    expect(beacons.map((batch) => batch.length)).toEqual([2, 1]);
    expect(queue.stats().pending).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.stats().sent).toBe(3);
  });

  it("cancels the interval flush", () => {
    const { queue, batches, beacons } = queueWith({ flushIntervalMs: 1000 });

    queue.enqueueRecord(info("event 1"));
    queue.flushOnExit();
    vi.advanceTimersByTime(5000);

    expect(beacons).toHaveLength(1);
    expect(batches).toEqual([]);
  });

  it("does nothing for an empty queue", () => {
    const { queue, beacons } = queueWith();

    queue.flushOnExit();

    expect(beacons).toEqual([]);
  });

  it("counts a batch the beacon refused, or threw on, as undelivered and never throws", () => {
    const refusing = queueWith({ beacon: () => false });
    refusing.queue.enqueueRecord(info("event 1"));
    const throwing = queueWith({
      beacon: () => {
        throw new Error(LEAK);
      },
    });
    throwing.queue.enqueueRecord(info("event 1"));

    expect(() => {
      refusing.queue.flushOnExit();
      throwing.queue.flushOnExit();
    }).not.toThrow();
    expect(refusing.queue.stats().droppedEvents.undelivered).toBe(1);
    expect(throwing.queue.stats().droppedEvents.undelivered).toBe(1);
  });
});
