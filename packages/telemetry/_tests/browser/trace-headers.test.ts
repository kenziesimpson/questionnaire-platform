import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectTraceHeaders, type HeadersInput } from "../../src/browser/trace-headers.js";
import { startBrowserTracing, stopBrowserTracing } from "../../src/browser/tracing.js";
import { activeTraceId, withSpan } from "../../src/index.js";
import { installFaultyMeter, internalDropsOf, restoreFaults } from "../faults.js";
import { SESSION_ID } from "../fixtures.js";

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

const STALE = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

afterEach(async () => {
  restoreFaults();
  await stopBrowserTracing();
});

async function headersInsideASpan(headers?: HeadersInput): Promise<Record<string, string> & { traceId: string; spanId: string }> {
  let captured: Record<string, string> = {};
  let traceId = "";
  let spanId = "";
  await withSpan("browser.request", { sessionId: SESSION_ID }, async () => {
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
    expect(injectTraceHeaders({ TraceParent: STALE, accept: "application/json" })).toEqual({ accept: "application/json" });
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

    const { traceId, spanId, ...headers } = await headersInsideASpan({ Traceparent: STALE, "content-type": "application/json" });

    expect(Object.keys(headers).sort()).toEqual(["content-type", "traceparent"]);
    expect(headers.traceparent).toBe(`00-${traceId}-${spanId}-01`);
  });
});

describe("injectTraceHeaders: the input shapes", () => {
  it("accepts a Headers object, lower-casing its names, and drops a stale traceparent", () => {
    const headers = new Headers({ Accept: "application/json", Traceparent: STALE });

    expect(injectTraceHeaders(headers)).toEqual({ accept: "application/json" });
  });

  it("accepts an array of pairs, keeps the first spelling of a name, joins a repeated name and drops a stale traceparent", () => {
    const pairs: HeadersInput = [
      ["Accept", "application/json"],
      ["accept", "application/problem+json"],
      ["TraceParent", STALE],
      ["content-type", "application/json"],
    ];

    expect(injectTraceHeaders(pairs)).toEqual({ Accept: "application/json, application/problem+json", "content-type": "application/json" });
  });

  it.each([
    ["a Headers object", (): HeadersInput => new Headers({ accept: "application/json", traceparent: STALE })],
    ["an array of pairs", (): HeadersInput => [["accept", "application/json"], ["traceparent", STALE]]],
    ["a record", (): HeadersInput => ({ accept: "application/json", traceparent: STALE })],
  ])("replaces the stale traceparent of %s with the active span's, and adds no other header", async (_shape, input) => {
    startBrowserTracing();

    const { traceId, spanId, ...headers } = await headersInsideASpan(input());

    expect(headers).toEqual({ accept: "application/json", traceparent: `00-${traceId}-${spanId}-01` });
  });

  it("returns a plain record for every input and never the input itself", () => {
    const record = { accept: "application/json" };

    expect(injectTraceHeaders(record)).not.toBe(record);
    expect(injectTraceHeaders([])).toEqual({});
    expect(injectTraceHeaders(new Headers())).toEqual({});
  });
});

describe("injectTraceHeaders under a fault", () => {
  it("returns the headers without a traceparent, and counts one internal span drop, when reading the active span throws", () => {
    const recorded = installFaultyMeter();
    vi.spyOn(trace, "getActiveSpan").mockImplementation(() => {
      throw new Error("span unavailable");
    });

    const injected = injectTraceHeaders({ accept: "application/json", Traceparent: STALE });

    expect(injected).toEqual({ accept: "application/json" });
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });
});
