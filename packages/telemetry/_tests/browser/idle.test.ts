import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterFirstPaint } from "../../src/browser/idle.js";
import { FakeWindow } from "./page-fakes.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function windowWithIdleCallbacks() {
  const page = new FakeWindow();
  const scheduled: (() => void)[] = [];
  const cancelled: number[] = [];
  const request = vi.fn((callback: () => void) => scheduled.push(callback));
  page.requestIdleCallback = request;
  page.cancelIdleCallback = (handle) => {
    cancelled.push(handle);
  };
  return { page, scheduled, cancelled, request };
}

describe("afterFirstPaint", () => {
  it("starts in an idle callback, not synchronously, once the page has loaded", () => {
    const { page, scheduled, request } = windowWithIdleCallbacks();
    const start = vi.fn();

    afterFirstPaint(start, page);

    expect(start).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    scheduled[0]?.();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not let a start that throws surface, and starts only once", () => {
    const { page, scheduled } = windowWithIdleCallbacks();
    const start = vi.fn(() => {
      throw new Error("start failed");
    });

    afterFirstPaint(start, page);

    expect(() => {
      scheduled[0]?.();
      scheduled[0]?.();
    }).not.toThrow();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("waits for load before asking for an idle callback", () => {
    const { page, scheduled, request } = windowWithIdleCallbacks();
    page.document.readyState = "loading";
    const start = vi.fn();

    afterFirstPaint(start, page);
    expect(request).not.toHaveBeenCalled();
    page.dispatch("load");

    expect(request).toHaveBeenCalledTimes(1);
    expect(page.listenerCount("load")).toBe(0);
    scheduled[0]?.();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timeout after load where there is no idle callback", () => {
    const page = new FakeWindow();
    page.document.readyState = "loading";
    const start = vi.fn();

    afterFirstPaint(start, page);
    vi.advanceTimersByTime(10_000);
    expect(start).not.toHaveBeenCalled();
    page.dispatch("load");
    vi.advanceTimersByTime(1999);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timeout at once for a page that has already loaded", () => {
    const page = new FakeWindow();
    const start = vi.fn();

    afterFirstPaint(start, page);
    vi.advanceTimersByTime(2000);

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts once however often the callback runs", () => {
    const { page, scheduled } = windowWithIdleCallbacks();
    const start = vi.fn();

    afterFirstPaint(start, page);
    scheduled[0]?.();
    scheduled[0]?.();

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("never starts once cancelled, before load or after the idle callback was requested", () => {
    const beforeLoad = windowWithIdleCallbacks();
    beforeLoad.page.document.readyState = "loading";
    const startBeforeLoad = vi.fn();
    afterFirstPaint(startBeforeLoad, beforeLoad.page)();
    beforeLoad.page.dispatch("load");

    const afterRequest = windowWithIdleCallbacks();
    const startAfterRequest = vi.fn();
    afterFirstPaint(startAfterRequest, afterRequest.page)();
    afterRequest.scheduled[0]?.();

    const withTimeout = new FakeWindow();
    const startWithTimeout = vi.fn();
    afterFirstPaint(startWithTimeout, withTimeout)();
    vi.advanceTimersByTime(10_000);

    expect(beforeLoad.request).not.toHaveBeenCalled();
    expect(beforeLoad.page.listenerCount("load")).toBe(0);
    expect(afterRequest.cancelled).toHaveLength(1);
    expect([startBeforeLoad, startAfterRequest, startWithTimeout].map((start) => start.mock.calls.length)).toEqual([0, 0, 0]);
  });
});
