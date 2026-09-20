import { telemetryApi } from "@qp/shared";
import { describe, expect, it } from "vitest";
import type { QueuedEvent } from "../../src/browser/events.js";
import { BEACON_BODY_BUDGET_BYTES, toBeaconBlob, toEnvelopes, toFetchInit, toWireEvent } from "../../src/browser/wire.js";
import { FIELDS } from "../../src/fields.js";
import { QUESTION_ID, SESSION_ID } from "../fixtures.js";

const AT = "2026-09-19T10:00:00.000Z";

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

const LEAK = "LEAK_DIABETES_8F3A";

function queued(overrides: Partial<QueuedEvent> = {}): QueuedEvent {
  return { level: "info", message: "screen shown", attributes: {}, at: AT, ...overrides };
}

function abandoned(overrides: Partial<QueuedEvent> = {}): QueuedEvent {
  return queued({ message: "session.abandoned", event: "session.abandoned", attributes: { [FIELDS.sessionId.attribute]: SESSION_ID }, ...overrides });
}

function stackOf(frames: number, width: number): string {
  return Array.from({ length: frames }, (_, index) => `    at ${"f".repeat(width)}${index} (chunk.js:1:2)`).join("\n");
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

describe("toWireEvent: the registry names", () => {
  it("renames dotted attribute keys to the registry field names, through FIELDS", () => {
    const wire = toWireEvent(
      queued({
        attributes: {
          [FIELDS.sessionId.attribute]: SESSION_ID,
          [FIELDS.questionId.attribute]: QUESTION_ID,
          [FIELDS.questionType.attribute]: "text",
          [FIELDS.route.attribute]: "/run/session",
          [FIELDS.method.attribute]: "POST",
          [FIELDS.errorType.attribute]: "TypeError",
        },
      }),
    );

    expect(wire.fields).toEqual({
      sessionId: SESSION_ID,
      questionId: QUESTION_ID,
      questionType: "text",
      route: "/run/session",
      method: "POST",
      errorType: "TypeError",
    });
  });

  it("drops an attribute the registry does not know, whatever its value", () => {
    const wire = toWireEvent(
      queued({ attributes: { module: "execution", trace_id: "0af7651916cd43dd8448eb211c80319c", answer: LEAK, "url.full": LEAK, [FIELDS.route.attribute]: "/run/x" } }),
    );

    expect(wire.fields).toEqual({ route: "/run/x" });
    expect(JSON.stringify(wire)).not.toContain(LEAK);
  });

  it("drops a registry field this event may not carry, and keeps the ones it may", () => {
    const client = toWireEvent(
      queued({ attributes: { [FIELDS.elapsedSeconds.attribute]: 12, [FIELDS.outcome.attribute]: "accepted", [FIELDS.source.attribute]: "browser", [FIELDS.sessionId.attribute]: SESSION_ID } }),
    );
    const domain = abandoned({
      attributes: {
        [FIELDS.elapsedSeconds.attribute]: 12,
        [FIELDS.route.attribute]: "/run/x",
        [FIELDS.lastItemId.attribute]: "itm_03",
        [FIELDS.sessionId.attribute]: SESSION_ID,
      },
    });

    expect(client.fields).toEqual({ sessionId: SESSION_ID });
    expect(toWireEvent(domain).fields).toEqual({ lastItemId: "itm_03", sessionId: SESSION_ID });
  });

  it("drops a value the ingest would refuse", () => {
    const wire = toWireEvent(
      queued({ attributes: { [FIELDS.sessionId.attribute]: "not-a-uuid", [FIELDS.method.attribute]: "TRACE", [FIELDS.errorType.attribute]: "RangeError" } }),
    );

    expect(wire.fields).toEqual({ errorType: "RangeError" });
  });

  it("holds an errorStack to the strict browser frame shape, not the lax one the server captures", () => {
    const browserFrame = "    at render (index-a1b2.js:10:20)";
    const lax = "    at render (/srv/app/index.js:10:20)";

    expect(toWireEvent(queued({ attributes: { [FIELDS.errorStack.attribute]: browserFrame } })).fields).toEqual({ errorStack: browserFrame });
    expect(toWireEvent(queued({ attributes: { [FIELDS.errorStack.attribute]: lax } })).fields).toBeUndefined();
  });

  it("omits fields altogether when none survive", () => {
    expect(toWireEvent(queued({ attributes: { module: "execution" } }))).toEqual({ name: "client.info", at: AT });
  });
});

describe("toWireEvent: the name", () => {
  it.each([
    ["info", "client.info"],
    ["warn", "client.warn"],
    ["error", "client.error"],
  ] as const)("names a %s record %s", (level, name) => {
    expect(toWireEvent(queued({ level })).name).toBe(name);
  });

  it("names a record marked as a browser domain event by the marker, whatever its level", () => {
    expect(toWireEvent(abandoned({ level: "info" })).name).toBe("session.abandoned");
    expect(toWireEvent(abandoned({ level: "warn" })).name).toBe("session.abandoned");
  });

  it("checks the marker against the closed list, so a marker that names another event is ignored", () => {
    const forged: Partial<QueuedEvent> = JSON.parse('{"event":"session.completed"}');

    expect(toWireEvent(queued({ ...forged, level: "warn" })).name).toBe("client.warn");
  });

  it("does not read the message: text that spells a domain event without the marker stays a client log", () => {
    expect(toWireEvent(queued({ message: "session.abandoned" })).name).toBe("client.info");
    expect(toWireEvent(queued({ level: "error", message: "session.abandoned" })).name).toBe("client.error");
  });

  it("never sends the message, whatever it says", () => {
    expect(JSON.stringify(toWireEvent(queued({ message: LEAK.toLowerCase() })))).not.toContain(LEAK.toLowerCase());
  });
});

describe("toWireEvent: the stamps", () => {
  it("carries the time it was queued, unchanged", () => {
    expect(toWireEvent(queued({ at: "2026-01-02T03:04:05.006Z" })).at).toBe("2026-01-02T03:04:05.006Z");
  });

  it("carries the traceparent when there is one, and has no traceparent key when there is not", () => {
    expect(toWireEvent(queued({ traceparent: TRACEPARENT })).traceparent).toBe(TRACEPARENT);
    expect(toWireEvent(queued())).not.toHaveProperty("traceparent");
  });
});

describe("toEnvelopes: the shape and the caps", () => {
  it("returns no envelope for no events", () => {
    expect(toEnvelopes([])).toEqual([]);
  });

  it("puts a few events in one envelope, in order", () => {
    const envelopes = toEnvelopes([queued({ level: "warn" }), queued({ level: "error" }), queued({ level: "info" })]);

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.events.map((event) => event.name)).toEqual(["client.warn", "client.error", "client.info"]);
  });

  it("splits by count at the shared cap, the last envelope holding the rest", () => {
    const many = Array.from({ length: telemetryApi.MAX_TELEMETRY_EVENTS * 2 + 5 }, () => queued());

    const envelopes = toEnvelopes(many);

    expect(envelopes.map((envelope) => envelope.events.length)).toEqual([50, 50, 5]);
  });

  it("fits exactly the cap in one envelope, and splits one event further", () => {
    const stack = { [FIELDS.errorStack.attribute]: stackOf(40, 90) };
    const events = Array.from({ length: 9 }, () => queued({ level: "error", attributes: stack }));
    const total = bytesOf({ events: events.map(toWireEvent) });
    const padding = telemetryApi.MAX_TELEMETRY_BODY_BYTES - total;
    const padded = (extra: number): QueuedEvent[] => events.map((event, index) => (index === 0 ? { ...event, at: `${AT}${"x".repeat(padding + extra)}` } : event));

    const atTheCap = toEnvelopes(padded(0));
    const overTheCap = toEnvelopes(padded(1));

    expect(padding).toBeGreaterThan(0);
    expect(atTheCap).toHaveLength(1);
    expect(bytesOf(atTheCap[0])).toBe(telemetryApi.MAX_TELEMETRY_BODY_BYTES);
    expect(overTheCap).toHaveLength(2);
    expect(overTheCap.map((envelope) => envelope.events.length)).toEqual([8, 1]);
  });

  it("measures bytes of the UTF-8 encoding, not characters", () => {
    const wide = Array.from({ length: 33 }, () => queued({ at: "€".repeat(700) }));

    const envelopes = toEnvelopes(wide);

    expect(JSON.stringify({ events: wide }).length).toBeLessThan(telemetryApi.MAX_TELEMETRY_BODY_BYTES);
    expect(envelopes.length).toBeGreaterThan(1);
    for (const envelope of envelopes) expect(bytesOf(envelope)).toBeLessThanOrEqual(telemetryApi.MAX_TELEMETRY_BODY_BYTES);
    expect(envelopes.flatMap((envelope) => envelope.events)).toHaveLength(33);
  });

  it("keeps every event across a split by bytes, in order, each envelope under both caps", () => {
    const events = Array.from({ length: 30 }, (_, index) =>
      queued({ level: "error", at: `2026-09-19T10:00:${String(index).padStart(2, "0")}.000Z`, attributes: { [FIELDS.errorStack.attribute]: stackOf(40, 90) } }),
    );

    const envelopes = toEnvelopes(events);

    expect(envelopes.length).toBeGreaterThan(2);
    for (const envelope of envelopes) {
      expect(bytesOf(envelope)).toBeLessThanOrEqual(telemetryApi.MAX_TELEMETRY_BODY_BYTES);
      expect(envelope.events.length).toBeLessThanOrEqual(telemetryApi.MAX_TELEMETRY_EVENTS);
    }
    expect(envelopes.flatMap((envelope) => envelope.events.map((event) => event.at))).toEqual(events.map((event) => event.at));
  });
});

describe("toEnvelopes: the beacon budget", () => {
  it("keeps a beacon envelope well under the server's limit", () => {
    expect(BEACON_BODY_BUDGET_BYTES).toBeLessThanOrEqual(telemetryApi.MAX_TELEMETRY_BODY_BYTES / 2);
  });

  it("splits at the budget it is given, each envelope within it, and at the server's limit by default", () => {
    const events = Array.from({ length: 30 }, () => queued({ level: "error", attributes: { [FIELDS.errorStack.attribute]: stackOf(40, 90) } }));

    const beacon = toEnvelopes(events, BEACON_BODY_BUDGET_BYTES);
    const fetched = toEnvelopes(events);

    expect(beacon.length).toBeGreaterThan(fetched.length);
    for (const envelope of beacon) expect(bytesOf(envelope)).toBeLessThanOrEqual(BEACON_BODY_BUDGET_BYTES);
    for (const envelope of fetched) expect(bytesOf(envelope)).toBeLessThanOrEqual(telemetryApi.MAX_TELEMETRY_BODY_BYTES);
    expect(beacon.flatMap((envelope) => envelope.events)).toHaveLength(30);
  });

  it("puts the abandonment in the first envelope, which stays within the budget", () => {
    const logs = Array.from({ length: 20 }, () => queued({ level: "error", attributes: { [FIELDS.errorStack.attribute]: stackOf(40, 90) } }));

    const [first] = toEnvelopes([...logs, abandoned()], BEACON_BODY_BUDGET_BYTES);

    expect(first?.events[0]?.name).toBe("session.abandoned");
    expect(bytesOf(first)).toBeLessThanOrEqual(BEACON_BODY_BUDGET_BYTES);
  });
});

describe("toEnvelopes: the abandonments first", () => {
  it("orders session.abandoned ahead of the client logs, each group keeping its own order", () => {
    const envelopes = toEnvelopes([
      queued({ level: "info", at: "2026-09-19T10:00:01.000Z" }),
      abandoned({ at: "2026-09-19T10:00:02.000Z" }),
      queued({ level: "warn", at: "2026-09-19T10:00:03.000Z" }),
      abandoned({ at: "2026-09-19T10:00:04.000Z" }),
    ]);

    expect(envelopes[0]?.events.map((event) => [event.name, event.at.slice(17, 19)])).toEqual([
      ["session.abandoned", "02"],
      ["session.abandoned", "04"],
      ["client.info", "01"],
      ["client.warn", "03"],
    ]);
  });

  it("puts an abandonment queued last into the first envelope when there are many envelopes", () => {
    const logs = Array.from({ length: telemetryApi.MAX_TELEMETRY_EVENTS * 2 }, () => queued());

    const envelopes = toEnvelopes([...logs, abandoned()]);

    expect(envelopes[0]?.events[0]?.name).toBe("session.abandoned");
    expect(envelopes.slice(1).flatMap((envelope) => envelope.events.map((event) => event.name))).not.toContain("session.abandoned");
  });
});

describe("the encodings", () => {
  const envelope = { events: [{ name: "client.warn" as const, at: AT, fields: { route: "/run/x" } }] };

  it("makes a beacon blob of type application/json holding the envelope's JSON", async () => {
    const blob = toBeaconBlob(envelope);

    expect(blob.type).toBe("application/json");
    expect(await blob.text()).toBe(JSON.stringify(envelope));
  });

  it("makes fetch options that POST the envelope's JSON as application/json", () => {
    const init = toFetchInit(envelope);

    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual(envelope);
  });
});
