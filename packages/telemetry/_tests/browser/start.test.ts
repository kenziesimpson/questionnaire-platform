import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueuedEvent } from "../../src/browser/events.js";
import { startBrowserTelemetry } from "../../src/browser/start.js";
import { stopBrowserTracing } from "../../src/browser/tracing.js";
import { emitDomainEvent, logger, type LogLevel } from "../../src/index.js";
import { SESSION_ID } from "../fixtures.js";
import { FakeWindow } from "./page-fakes.js";

const log = logger("execution");

afterEach(async () => {
  await stopBrowserTracing();
});

function started(overrides: { debug?: (record: { level: LogLevel; message: string }) => void } = {}) {
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
  return { page, sent, beaconed, telemetry };
}

describe("startBrowserTelemetry", () => {
  it("sends the logger's and a domain event's records through the queue as registry fields only", () => {
    const { telemetry, sent } = started();

    log.info("session submitted", { sessionId: SESSION_ID });
    emitDomainEvent({ name: "session.abandoned", sessionId: SESSION_ID, lastItemId: "itm_03" });
    telemetry.queue.flush();

    expect(sent).toEqual([
      { level: "info", message: "session submitted", attributes: { "questionnaire.session_id": SESSION_ID, module: "execution" } },
      {
        level: "info",
        message: "session.abandoned",
        attributes: { "questionnaire.session_id": SESSION_ID, "questionnaire.last_item_id": "itm_03", module: "events" },
      },
    ]);
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

  it("stops everything it started, flushing what is queued through send", () => {
    const { page, sent, beaconed, telemetry } = started();
    log.info("session submitted");

    telemetry.stop();
    log.info("after stop");
    page.dispatch("error", { error: new Error("boom") });
    page.dispatch("pagehide");

    expect(sent.map((event) => event.message)).toEqual(["session submitted"]);
    expect(beaconed).toEqual([]);
    expect([page.listenerCount("error"), page.listenerCount("unhandledrejection"), page.listenerCount("pagehide")]).toEqual([0, 0, 0]);
    expect(page.document.listenerCount("visibilitychange")).toBe(0);
  });
});
