import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueuedEvent } from "../../src/browser/events.js";
import { startBrowserTelemetry, type BrowserTelemetry } from "../../src/browser/start.js";
import { stopBrowserTracing } from "../../src/browser/tracing.js";
import { injectTraceHeaders } from "../../src/browser/trace-headers.js";
import { emitDomainEvent, logger, withSpan, type LogLevel } from "../../src/index.js";
import { currentLogging } from "../../src/logger.js";
import { SESSION_ID } from "../fixtures.js";
import { FakeWindow } from "./page-fakes.js";

const log = logger("execution");

const running: BrowserTelemetry[] = [];

afterEach(async () => {
  for (const telemetry of running.splice(0)) telemetry.stop();
  await stopBrowserTracing();
});

function started(overrides: { debug?: (record: { level: LogLevel; message: string }) => void; beforeExit?: () => void } = {}) {
  const page = new FakeWindow();
  const sent: QueuedEvent[] = [];
  const beaconed: QueuedEvent[] = [];
  const telemetry = startBrowserTelemetry({
    page,
    send: (events) => {
      sent.push(...events);
    },
    beacon: (events) => {
      beaconed.push(...events);
      return true;
    },
    ...overrides,
  });
  running.push(telemetry);
  return { page, sent, beaconed, telemetry };
}

describe("startBrowserTelemetry", () => {
  it("sends the logger's and a domain event's records through the queue as registry fields only", () => {
    const { telemetry, sent } = started();

    log.info("session submitted", { sessionId: SESSION_ID });
    emitDomainEvent({ name: "session.abandoned", sessionId: SESSION_ID, lastItemId: "itm_03" });
    telemetry.queue.flush();

    expect(sent).toEqual([
      { level: "info", at: expect.any(String), message: "session submitted", attributes: { "questionnaire.session_id": SESSION_ID, module: "execution" } },
      {
        level: "info",
        at: expect.any(String),
        event: "session.abandoned",
        message: "session.abandoned",
        attributes: { "questionnaire.session_id": SESSION_ID, "questionnaire.last_item_id": "itm_03", module: "events" },
      },
    ]);
  });

  it("does not mark a logger call from app code in the events module as a browser domain event", () => {
    const { telemetry, sent } = started();

    logger("events").info("session.abandoned", { sessionId: SESSION_ID, lastItemId: "itm_03" });
    telemetry.queue.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ message: "session.abandoned", attributes: { module: "events" } });
    expect(sent[0]).not.toHaveProperty("event");
  });

  it("never queues debug, and passes it to the debug sink only when one is given", () => {
    const withoutSink = started();
    log.debug("rule evaluated");
    withoutSink.telemetry.queue.flush();
    withoutSink.telemetry.stop();

    const debug = vi.fn();
    const withSink = started({ debug });
    log.debug("rule evaluated");
    log.info("session submitted");
    withSink.telemetry.queue.flush();

    expect(withoutSink.sent).toEqual([]);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(withSink.sent.map((event) => event.message)).toEqual(["session submitted"]);
  });

  it("survives a debug sink that throws", () => {
    started({
      debug: () => {
        throw new Error("console unavailable");
      },
    });

    expect(() => {
      log.debug("rule evaluated");
    }).not.toThrow();
  });

  it("captures unhandled errors and rejections", () => {
    const { page, telemetry } = started();

    page.dispatch("error", { error: new Error("boom") });
    page.dispatch("unhandledrejection", { reason: new Error("boom") });

    expect(telemetry.queue.stats().pending).toBe(2);
  });

  it("hands what is left to the beacon on pagehide", () => {
    const { page, sent, beaconed } = started();
    log.info("session submitted");

    page.dispatch("pagehide");

    expect(beaconed.map((event) => event.message)).toEqual(["session submitted"]);
    expect(sent).toEqual([]);
  });

  it("runs beforeExit before it hands what is queued to the beacon, so the abandonment it emits is beaconed, ahead of the rest", () => {
    const { page, beaconed } = started({
      beforeExit: () => {
        emitDomainEvent({ name: "session.abandoned", sessionId: SESSION_ID, lastItemId: "itm_03" });
      },
    });
    log.info("session submitted");

    page.dispatch("pagehide");

    expect(beaconed.map((event) => event.message)).toEqual(["session.abandoned", "session submitted"]);
    expect(beaconed.map((event) => event.event)).toEqual(["session.abandoned", undefined]);
  });

  it("stops everything it started, handing what is queued to the beacon", () => {
    const { page, sent, beaconed, telemetry } = started();
    log.info("session submitted");

    telemetry.stop();
    log.info("after stop");
    page.dispatch("error", { error: new Error("boom") });
    page.dispatch("pagehide");

    expect(beaconed.map((event) => event.message)).toEqual(["session submitted"]);
    expect(sent).toEqual([]);
    expect([page.listenerCount("error"), page.listenerCount("unhandledrejection"), page.listenerCount("pagehide")]).toEqual([0, 0, 0]);
    expect(page.document.listenerCount("visibilitychange")).toBe(0);
  });

  it("does not send again after stop when a send was in flight", async () => {
    vi.useFakeTimers();
    const releases: (() => void)[] = [];
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const telemetry = startBrowserTelemetry({ page: new FakeWindow(), send, beacon: () => true, batchSize: 2 });
    running.push(telemetry);

    for (const message of ["event 1", "event 2", "event 3", "event 4"]) {
      telemetry.queue.enqueueRecord({ level: "info", message, attributes: {} });
    }
    telemetry.stop();
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("restores the logging that was configured before it started when it stops", () => {
    const before = currentLogging();
    const { telemetry } = started();

    expect(currentLogging().sink).not.toBe(before.sink);
    telemetry.stop();

    expect(currentLogging()).toEqual(before);
  });

  it("does not start tracing: inside a span there is no traceparent until the app starts it", async () => {
    started();
    let headers: Record<string, string> = { unset: "unset" };

    await withSpan("browser.request", {}, async () => {
      headers = injectTraceHeaders();
    });

    expect(headers).toEqual({});
  });

  it("starts once: a second call returns the running handle and adds no listeners, and a stopped one can start again", () => {
    const { page, telemetry } = started();

    const second = startBrowserTelemetry({ page: new FakeWindow(), send: () => undefined, beacon: () => true });

    expect(second).toBe(telemetry);
    expect(page.listenerCount("error")).toBe(1);
    telemetry.stop();
    expect(started().telemetry).not.toBe(telemetry);
  });
});
