import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueuedEvent } from "../../src/browser/events.js";
import { createEventQueue } from "../../src/browser/queue.js";
import { browserTransport, createTransport, type TransportOptions } from "../../src/browser/transport.js";
import { BEACON_BODY_BUDGET_BYTES } from "../../src/browser/wire.js";
import { ingestBatch } from "../../src/index.js";
import { installTestTelemetry, type TestTelemetry } from "../../src/testing.js";
import { SESSION_ID } from "../fixtures.js";

const URL_PATH = "/api/telemetry";

const AT = "2026-09-19T10:00:00.000Z";

const MAX_BODY_BYTES = 65_536;

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await telemetry?.shutdown();
  telemetry = undefined;
});

function event(message: string, attributes: QueuedEvent["attributes"] = {}): QueuedEvent {
  return { level: "info", at: AT, message, attributes };
}

function abandonment(): QueuedEvent {
  return {
    level: "info",
    at: AT,
    message: "session.abandoned",
    event: "session.abandoned",
    attributes: { "questionnaire.session_id": SESSION_ID, "questionnaire.last_item_id": "itm_03", module: "events" },
  };
}

function longStack(): string {
  return Array.from({ length: 40 }, (_line, index) => `    at ${"f".repeat(90)} (${"s".repeat(70)}.js:${String(index + 1)}:1)`).join("\n");
}

function heavyBatch(): QueuedEvent[] {
  return Array.from({ length: 20 }, () => event("boom", { "error.type": "TypeError", "error.stack": longStack() }));
}

function transportWith(overrides: Partial<Pick<TransportOptions, "fetch" | "sendBeacon">> = {}) {
  const posted: { url: string; init: Parameters<TransportOptions["fetch"]>[1] }[] = [];
  const beaconed: { url: string; blob: Blob }[] = [];
  const transport = createTransport({
    url: URL_PATH,
    fetch:
      overrides.fetch ??
      ((url, init) => {
        posted.push({ url, init });
        return Promise.resolve({ ok: true });
      }),
    sendBeacon:
      overrides.sendBeacon ??
      ((url, blob) => {
        beaconed.push({ url, blob });
        return true;
      }),
  });
  return { transport, posted, beaconed };
}

describe("createTransport: send", () => {
  it("posts one application/json envelope to the url for a batch that fits, in the shape the ingest reads", async () => {
    const { transport, posted } = transportWith();

    await transport.send([event("session submitted", { "questionnaire.session_id": SESSION_ID })]);

    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe(URL_PATH);
    expect(posted[0]?.init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(posted[0]?.init.body ?? "{}")).toEqual({ events: [{ name: "client.info", at: AT, fields: { sessionId: SESSION_ID } }] });
  });

  it("splits a batch that is over the body cap into several posts, none over it, and sends every event once", async () => {
    const { transport, posted } = transportWith();

    await transport.send(heavyBatch());

    expect(posted.length).toBeGreaterThan(1);
    expect(posted.every((post) => new TextEncoder().encode(post.init.body).length <= MAX_BODY_BYTES)).toBe(true);
    expect(posted.flatMap((post) => JSON.parse(post.init.body).events)).toHaveLength(20);
  });

  it("rejects when the response is not ok, so the queue counts the batch undelivered", async () => {
    const { transport } = transportWith({ fetch: () => Promise.resolve({ ok: false }) });

    await expect(transport.send([event("a")])).rejects.toThrow();
  });

  it("rejects when fetch rejects, and posts nothing after the failed envelope", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("offline")));
    const { transport } = transportWith({ fetch });

    await expect(transport.send(heavyBatch())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("feeds the queue's undelivered count when it rejects", async () => {
    vi.useFakeTimers();
    const { transport } = transportWith({ fetch: () => Promise.resolve({ ok: false }) });
    const queue = createEventQueue({ ...transport, batchSize: 1 });

    queue.enqueueRecord({ level: "info", message: "session submitted", attributes: {} });
    await vi.advanceTimersByTimeAsync(0);

    expect(queue.stats().droppedEvents.undelivered).toBe(1);
    expect(queue.stats().sent).toBe(0);
  });
});

describe("createTransport: beacon", () => {
  it("hands the beacon a Blob typed application/json, so the ingest reads it as JSON and not text", async () => {
    const { transport, beaconed } = transportWith();

    expect(transport.beacon([abandonment()])).toBe(true);

    expect(beaconed).toHaveLength(1);
    expect(beaconed[0]?.url).toBe(URL_PATH);
    expect(beaconed[0]?.blob.type).toBe("application/json");
    expect(JSON.parse(await (beaconed[0]?.blob.text() ?? Promise.resolve("{}")))).toEqual({
      events: [{ name: "session.abandoned", at: AT, fields: { sessionId: SESSION_ID, lastItemId: "itm_03" } }],
    });
  });

  it("keeps every beacon body within the beacon budget, splitting a heavy batch and putting the abandonment in the first body", async () => {
    const { transport, beaconed } = transportWith();

    transport.beacon([...heavyBatch(), abandonment()]);

    expect(beaconed.length).toBeGreaterThan(1);
    expect(beaconed.every(({ blob }) => blob.size <= BEACON_BODY_BUDGET_BYTES)).toBe(true);
    expect(await (beaconed[0]?.blob.text() ?? Promise.resolve(""))).toContain("session.abandoned");
  });

  it("is true for nothing to send, and false when the browser refuses any body", () => {
    const refusing = transportWith({ sendBeacon: () => false });

    expect(refusing.transport.beacon([])).toBe(true);
    expect(refusing.transport.beacon([event("a")])).toBe(false);
  });

  it("feeds the queue's beaconed count, apart from its sent count", () => {
    const { transport } = transportWith();
    const queue = createEventQueue(transport);

    queue.enqueueRecord({ level: "info", message: "session submitted", attributes: {} });
    queue.flushOnExit();

    expect(queue.stats().beaconed).toBe(1);
    expect(queue.stats().sent).toBe(0);
  });

  it("carries the page's traceparent on every event of the beacon body, one trace id and a span id of its own for each", async () => {
    const { transport, beaconed } = transportWith();
    const queue = createEventQueue(transport);

    queue.enqueueRecord({ level: "info", message: "session submitted", attributes: {} });
    queue.enqueueRecord({ level: "warn", message: "request retried", attributes: {} });
    queue.flushOnExit();

    const bodies = await Promise.all(beaconed.map(({ blob }) => blob.text()));
    const events: { traceparent?: string }[] = bodies.flatMap((body) => JSON.parse(body).events);
    const parts = events.map((event) => (event.traceparent ?? "").split("-"));
    expect(parts).toHaveLength(2);
    for (const [version, traceId, spanId, flags] of parts) {
      expect([version, flags]).toEqual(["00", "00"]);
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(parts[1]?.[1]).toBe(parts[0]?.[1]);
    expect(parts[1]?.[2]).not.toBe(parts[0]?.[2]);
  });

  it("produces a body the real ingest accepts whole", async () => {
    telemetry = installTestTelemetry();
    const { transport, beaconed } = transportWith();

    transport.beacon([abandonment(), event("session submitted", { "questionnaire.session_id": SESSION_ID })]);
    const bodies = await Promise.all(beaconed.map(({ blob }) => blob.text()));
    const receipts = bodies.map((body) => ingestBatch(JSON.parse(body).events, Date.parse("2026-09-19T10:00:05.000Z")));

    expect(receipts).toEqual([{ accepted: 2, dropped: 0 }]);
  });
});

describe("browserTransport", () => {
  it("posts an application/json envelope to /api/telemetry with the global fetch, looked up when it sends", async () => {
    const transport = browserTransport();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ accepted: 1, dropped: 0 }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await transport.send([abandonment()]);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(URL_PATH);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      events: [{ name: "session.abandoned", at: AT, fields: { sessionId: SESSION_ID, lastItemId: "itm_03" } }],
    });
  });

  it("rejects when the ingest answers with an error status, so the queue counts the batch undelivered", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 429 })));

    await expect(browserTransport().send([abandonment()])).rejects.toThrow();
  });

  it("hands navigator.sendBeacon a Blob typed application/json at /api/telemetry, called on navigator", () => {
    const calls: { self: unknown; url: string; data: unknown }[] = [];
    const host = {
      sendBeacon(this: unknown, url: string, data: unknown): boolean {
        calls.push({ self: this, url, data });
        return true;
      },
    };
    vi.stubGlobal("navigator", host);

    const accepted = browserTransport().beacon([abandonment()]);

    expect(accepted).toBe(true);
    expect(calls[0]?.self).toBe(host);
    expect(calls[0]?.url).toBe(URL_PATH);
    expect(calls[0]?.data instanceof Blob ? calls[0].data.type : undefined).toBe("application/json");
  });

  it.each([
    ["no fetch", { fetch: undefined }],
    ["a fetch that is not a function", { fetch: "fetch" }],
  ])("is inert with %s: a send rejects and posts nothing", async (_name, globals) => {
    vi.stubGlobal("fetch", globals.fetch);

    await expect(browserTransport().send([abandonment()])).rejects.toThrow();
  });

  it.each([
    ["no navigator", undefined],
    ["a navigator without sendBeacon", {}],
    ["a null navigator", null],
    ["a sendBeacon that is not a function", { sendBeacon: true }],
  ])("is inert with %s: a beacon reports the events undelivered and throws nothing", (_name, navigator) => {
    vi.stubGlobal("navigator", navigator);

    expect(browserTransport().beacon([abandonment()])).toBe(false);
  });

  it("reports false when the browser refuses the body", () => {
    vi.stubGlobal("navigator", { sendBeacon: () => false });

    expect(browserTransport().beacon([abandonment()])).toBe(false);
  });
});
