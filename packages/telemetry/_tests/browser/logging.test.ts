import { afterEach, describe, expect, it, vi } from "vitest";
import { routeLogsToQueue } from "../../src/browser/logging.js";
import { logger } from "../../src/index.js";
import { configureLogging, currentLogging, resetLogging } from "../../src/logger.js";
import { SESSION_ID } from "../fixtures.js";

const log = logger("execution");

afterEach(resetLogging);

function recordingQueue() {
  const messages: string[] = [];
  return {
    messages,
    queue: {
      enqueueRecord: (record: { readonly message: unknown }) => {
        messages.push(String(record.message));
      },
    },
  };
}

describe("routeLogsToQueue", () => {
  it("hands info, warn and error to the queue, and debug to the debug function alone", () => {
    const { queue, messages } = recordingQueue();
    const debug = vi.fn();
    const remove = routeLogsToQueue(queue, { debug });

    log.debug("rule evaluated");
    log.info("session submitted", { sessionId: SESSION_ID });
    remove();

    expect(messages).toEqual(["session submitted"]);
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("restores the sink and the level that were configured before it, rather than clearing them", () => {
    const earlier: string[] = [];
    configureLogging({
      level: "warn",
      sink: (record) => {
        earlier.push(record.message);
      },
    });
    const before = currentLogging();
    const { queue, messages } = recordingQueue();

    const remove = routeLogsToQueue(queue);
    log.info("routed");
    remove();
    log.warn("restored");
    log.info("below the restored level");

    expect(currentLogging()).toEqual(before);
    expect(messages).toEqual(["routed"]);
    expect(earlier).toEqual(["restored"]);
  });

  it("leaves no sink behind when there was none before it", () => {
    const { queue } = recordingQueue();

    routeLogsToQueue(queue)();

    expect(currentLogging().sink).toBeUndefined();
  });

  it("leaves alone a sink that something else configured after it", () => {
    const { queue } = recordingQueue();
    const remove = routeLogsToQueue(queue);
    const later = vi.fn();
    configureLogging({ level: "info", sink: later });

    remove();
    log.info("after removal");

    expect(later).toHaveBeenCalledTimes(1);
    expect(currentLogging().sink).toBe(later);
  });

  it("survives a debug function that throws", () => {
    const { queue } = recordingQueue();
    const remove = routeLogsToQueue(queue, {
      debug: () => {
        throw new Error("console unavailable");
      },
    });

    expect(() => {
      log.debug("rule evaluated");
    }).not.toThrow();
    remove();
  });
});
