import type { QueuedEvent } from "@qp/telemetry/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserTransport } from "../../src/api/telemetry-transport";
import { SESSION_ID } from "../fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const event: QueuedEvent = {
  level: "info",
  at: "2026-09-19T10:00:00.000Z",
  event: "session.abandoned",
  message: "session.abandoned",
  attributes: { "questionnaire.session_id": SESSION_ID, module: "events" },
};

describe("browserTransport", () => {
  it("posts an application/json envelope to /api/telemetry with fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ accepted: 1, dropped: 0 }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await browserTransport().send([event]);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/telemetry");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      events: [{ name: "session.abandoned", at: event.at, fields: { sessionId: SESSION_ID } }],
    });
  });

  it("rejects when the ingest answers with an error status, so the queue counts the batch undelivered", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 429 })));

    await expect(browserTransport().send([event])).rejects.toThrow();
  });

  it("hands navigator.sendBeacon a Blob typed application/json at /api/telemetry", async () => {
    const sendBeacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });

    const accepted = browserTransport().beacon([event]);

    expect(accepted).toBe(true);
    const [url, data] = sendBeacon.mock.calls[0] ?? [];
    expect(url).toBe("/api/telemetry");
    expect(data instanceof Blob ? data.type : undefined).toBe("application/json");
  });
});
