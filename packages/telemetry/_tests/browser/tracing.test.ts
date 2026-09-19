import { context, trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectTraceHeaders, startBrowserTracing, stopBrowserTracing } from "../../src/browser/tracing.js";
import { activeTraceId, withSpan } from "../../src/index.js";
import { installFaultyMeter, internalDropsOf, restoreFaults } from "../faults.js";
import { SESSION_ID } from "../fixtures.js";

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

afterEach(async () => {
  restoreFaults();
  await stopBrowserTracing();
});

async function headersInsideASpan(headers?: Readonly<Record<string, string>>): Promise<Record<string, string> & { traceId: string; spanId: string }> {
  let captured: Record<string, string> = {};
  let traceId = "";
  let spanId = "";
  await withSpan("session.submit", { sessionId: SESSION_ID }, async () => {
    captured = injectTraceHeaders(headers);
    traceId = activeTraceId() ?? "";
    spanId = trace.getActiveSpan()?.spanContext().spanId ?? "";
  });
  return { ...captured, traceId, spanId };
}

describe("injectTraceHeaders", () => {
  it("returns the headers unchanged, as a copy, when there is no active span", () => {
    const headers = { accept: "application/json" };

    const injected = injectTraceHeaders(headers);

    expect(injected).toEqual({ accept: "application/json" });
    expect(injected).not.toBe(headers);
  });

  it("drops a traceparent already present when there is no active span, so a stale one is never propagated", () => {
    const stale = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

    expect(injectTraceHeaders({ TraceParent: stale, accept: "application/json" })).toEqual({ accept: "application/json" });
  });

  it("returns no headers when given none and there is no active span", () => {
    startBrowserTracing();

    expect(injectTraceHeaders()).toEqual({});
  });

  it("adds a W3C traceparent for the active span and no other header", async () => {
    startBrowserTracing();

    const { traceId, spanId, ...headers } = await headersInsideASpan({ accept: "application/json" });

    expect(Object.keys(headers).sort()).toEqual(["accept", "traceparent"]);
    expect(headers.traceparent).toMatch(TRACEPARENT);
    expect(headers.traceparent).toBe(`00-${traceId}-${spanId}-01`);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("carries ids only: the header is version, trace id, span id and flags", async () => {
    startBrowserTracing();

    const { traceparent } = await headersInsideASpan();

    expect(traceparent?.split("-")).toHaveLength(4);
    expect(traceparent).not.toMatch(/[/:?=]/);
  });

  it("replaces a traceparent already present, whatever its case, and keeps the other headers", async () => {
    startBrowserTracing();
    const stale = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

    const { traceId, spanId, ...headers } = await headersInsideASpan({ Traceparent: stale, "content-type": "application/json" });

    expect(Object.keys(headers).sort()).toEqual(["content-type", "traceparent"]);
    expect(headers.traceparent).toBe(`00-${traceId}-${spanId}-01`);
  });

  it("starts tracing once however many times it is asked to", async () => {
    startBrowserTracing();
    startBrowserTracing();

    const { traceparent } = await headersInsideASpan();

    expect(traceparent).toMatch(TRACEPARENT);
  });

  it("adds nothing once tracing has stopped", async () => {
    startBrowserTracing();
    await stopBrowserTracing();

    const { traceparent } = await headersInsideASpan({ accept: "application/json" });

    expect(traceparent).toBeUndefined();
  });
});

describe("the tracing helpers under a fault", () => {
  it("returns the headers without a traceparent, and counts one internal span drop, when reading the active span throws", () => {
    const recorded = installFaultyMeter();
    vi.spyOn(trace, "getActiveSpan").mockImplementation(() => {
      throw new Error("span unavailable");
    });

    const injected = injectTraceHeaders({ accept: "application/json", Traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" });

    expect(injected).toEqual({ accept: "application/json" });
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

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
});
