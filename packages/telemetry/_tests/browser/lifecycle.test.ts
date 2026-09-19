import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushOnPageHide } from "../../src/browser/lifecycle.js";
import { createEventQueue } from "../../src/browser/queue.js";
import type { QueuedEvent } from "../../src/browser/events.js";
import { FakeWindow } from "./page-fakes.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function pendingQueue() {
  const beacons: (readonly QueuedEvent[])[] = [];
  const send = vi.fn();
  const queue = createEventQueue({
    send,
    beacon: (events) => {
      beacons.push(events);
      return true;
    },
  });
  queue.enqueue({ level: "info", message: "session abandoned", attributes: {} });
  return { queue, beacons, send };
}

describe("flushOnPageHide", () => {
  it("hands what is queued to the beacon on pagehide", () => {
    const { queue, beacons, send } = pendingQueue();
    const page = new FakeWindow();
    flushOnPageHide(queue, page);

    page.dispatch("pagehide");

    expect(beacons.map((batch) => batch.map((event) => event.message))).toEqual([["session abandoned"]]);
    expect(send).not.toHaveBeenCalled();
    expect(queue.stats().pending).toBe(0);
  });

  it("hands what is queued to the beacon when the page becomes hidden", () => {
    const { queue, beacons } = pendingQueue();
    const page = new FakeWindow();
    flushOnPageHide(queue, page);
    page.document.visibilityState = "hidden";

    page.document.dispatch("visibilitychange");

    expect(beacons).toHaveLength(1);
  });

  it("does nothing when the page becomes visible again", () => {
    const { queue, beacons } = pendingQueue();
    const page = new FakeWindow();
    flushOnPageHide(queue, page);
    page.document.visibilityState = "visible";

    page.document.dispatch("visibilitychange");

    expect(beacons).toEqual([]);
    expect(queue.stats().pending).toBe(1);
  });

  it("does not send the same events twice when both events fire", () => {
    const { queue, beacons } = pendingQueue();
    const page = new FakeWindow();
    flushOnPageHide(queue, page);
    page.document.visibilityState = "hidden";

    page.document.dispatch("visibilitychange");
    page.dispatch("pagehide");

    expect(beacons).toHaveLength(1);
  });

  it("stops listening when removed", () => {
    const { queue, beacons } = pendingQueue();
    const page = new FakeWindow();
    const remove = flushOnPageHide(queue, page);

    remove();
    page.document.visibilityState = "hidden";
    page.dispatch("pagehide");
    page.document.dispatch("visibilitychange");

    expect([page.listenerCount("pagehide"), page.document.listenerCount("visibilitychange")]).toEqual([0, 0]);
    expect(beacons).toEqual([]);
  });
});
