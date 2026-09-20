import { context, isSpanContextValid, trace } from "@opentelemetry/api";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectTraceHeaders } from "../../src/browser/trace-headers.js";
import { startBrowserTracing, stopBrowserTracing } from "../../src/browser/tracing.js";
import { withSpan } from "../../src/index.js";
import { installFaultyMeter, internalDropsOf, restoreFaults } from "../faults.js";
import { SESSION_ID } from "../fixtures.js";

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

afterEach(async () => {
  restoreFaults();
  await stopBrowserTracing();
});

async function traceparentInsideASpan(): Promise<string | undefined> {
  let captured: string | undefined;
  await withSpan("browser.request", { sessionId: SESSION_ID }, async () => {
    captured = injectTraceHeaders().traceparent;
  });
  return captured;
}

describe("startBrowserTracing and stopBrowserTracing", () => {
  it("makes a span's ids available to injectTraceHeaders, once however many times it is asked to start", async () => {
    startBrowserTracing();
    startBrowserTracing();

    expect(await traceparentInsideASpan()).toMatch(TRACEPARENT);
  });

  it("adds nothing once tracing has stopped", async () => {
    startBrowserTracing();
    await stopBrowserTracing();

    expect(await traceparentInsideASpan()).toBeUndefined();
  });

  it("adds nothing before tracing has started, since no tracer provider is registered", async () => {
    expect(await traceparentInsideASpan()).toBeUndefined();
  });
});

describe("the tracing helpers under a fault", () => {
  it("does not throw, and counts one internal span drop, when the tracer provider cannot be registered", () => {
    const recorded = installFaultyMeter();
    vi.spyOn(context, "setGlobalContextManager").mockImplementation(() => {
      throw new Error("context manager unavailable");
    });

    expect(() => {
      startBrowserTracing();
    }).not.toThrow();
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("leaves no tracer provider registered when the context manager cannot be, so no span carries ids", () => {
    installFaultyMeter();
    vi.spyOn(context, "setGlobalContextManager").mockImplementation(() => {
      throw new Error("context manager unavailable");
    });

    startBrowserTracing();

    expect(isSpanContextValid(trace.getTracer("test").startSpan("orphan").spanContext())).toBe(false);
  });

  it("still disables the context manager, does not throw and counts one internal span drop when the tracer provider cannot be disabled", async () => {
    startBrowserTracing();
    const recorded = installFaultyMeter();
    const contextDisable = vi.spyOn(context, "disable");
    vi.spyOn(trace, "disable").mockImplementation(() => {
      throw new Error("disable failed");
    });

    await expect(stopBrowserTracing()).resolves.toBeUndefined();

    expect(contextDisable).toHaveBeenCalledTimes(1);
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("does not throw and counts one internal span drop when the provider rejects its shutdown", async () => {
    startBrowserTracing();
    const recorded = installFaultyMeter();
    vi.spyOn(WebTracerProvider.prototype, "shutdown").mockRejectedValue(new Error("shutdown failed"));

    await expect(stopBrowserTracing()).resolves.toBeUndefined();

    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });
});
