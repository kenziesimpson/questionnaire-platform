import { context, createTraceState, defaultTextMapGetter, propagation, ROOT_CONTEXT, trace, type Context } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { addSqlCommenterComment } from "@opentelemetry/sql-common";
import { afterEach, describe, expect, it } from "vitest";
import { activeClientTraceId } from "../src/client-trace.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { TraceparentOnlyPropagator } from "../src/trace-propagator.js";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const LEAK = "LEAK_DIABETES_8F3A";
const HOSTILE_TRACESTATE = `vendor=${LEAK},${"k".repeat(200)}=${"v".repeat(250)}`;

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
});

function startedUnder(extracted: Context) {
  const span = context.with(extracted, () => trace.getTracer("probe").startSpan("request"));
  span.end();
  return span;
}

describe("the propagator the pipeline registers: extract", () => {
  it("parses traceparent into a client trace id and sets no remote parent, whatever tracestate comes with it", () => {
    telemetry = installTestTelemetry();

    const extracted = propagation.extract(ROOT_CONTEXT, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`, tracestate: HOSTILE_TRACESTATE });

    expect(trace.getSpanContext(extracted)).toBeUndefined();
    expect(trace.getSpan(extracted)).toBeUndefined();
    expect(activeClientTraceId(extracted)).toBe(TRACE_ID);
  });

  it.each([
    ["sampled", "01"],
    ["not sampled", "00"],
    ["a flag no one defined", "ff"],
  ])("ignores the caller's trace flags, so a request that says it is %s starts a new, sampled trace of its own", (_name, flags) => {
    telemetry = installTestTelemetry();

    const span = startedUnder(propagation.extract(ROOT_CONTEXT, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-${flags}` }));

    expect(span.spanContext().traceFlags).toBe(1);
    expect(span.spanContext().traceId).not.toBe(TRACE_ID);
    expect(telemetry.spans().map((exported) => exported.name)).toEqual(["request"]);
  });

  it("starts a root span with a fresh backend trace id, no parent and no tracestate, and never the caller's span id", () => {
    telemetry = installTestTelemetry();
    const inbound = propagation.extract(ROOT_CONTEXT, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`, tracestate: HOSTILE_TRACESTATE });

    const first = startedUnder(inbound);
    const second = startedUnder(inbound);

    for (const span of [first, second]) {
      expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span.spanContext().traceId).not.toBe(TRACE_ID);
      expect(span.spanContext().spanId).not.toBe(SPAN_ID);
      expect(span.spanContext().traceState).toBeUndefined();
    }
    expect(first.spanContext().traceId).not.toBe(second.spanContext().traceId);
    expect(telemetry.spans().map((span) => span.parentSpanContext)).toEqual([undefined, undefined]);
  });

  it("puts the client trace id on the root span of the request and on no span under it", () => {
    telemetry = installTestTelemetry();
    const inbound = propagation.extract(ROOT_CONTEXT, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` });

    context.with(inbound, () => {
      const root = trace.getTracer("probe").startSpan("request");
      context.with(trace.setSpan(context.active(), root), () => {
        trace.getTracer("probe").startSpan("child").end();
      });
      root.end();
    });

    const byName = Object.fromEntries(telemetry.spans().map((span) => [span.name, span.attributes["client.trace_id"]]));
    expect(byName).toEqual({ request: TRACE_ID, child: undefined });
  });

  it("puts no client trace id on a span started with none inbound", () => {
    telemetry = installTestTelemetry();

    startedUnder(propagation.extract(ROOT_CONTEXT, {}));

    expect(telemetry.spans().map((span) => span.attributes["client.trace_id"])).toEqual([undefined]);
  });

  it.each([
    ["not hex", `00-${"g".repeat(32)}-${SPAN_ID}-01`],
    ["a trace id that is too short", `00-${TRACE_ID.slice(1)}-${SPAN_ID}-01`],
    ["a trace id that is too long", `00-${TRACE_ID}0-${SPAN_ID}-01`],
    ["an oversized trace id", `00-${"a".repeat(4096)}-${SPAN_ID}-01`],
    ["a span id that is too long", `00-${TRACE_ID}-${SPAN_ID}0-01`],
    ["an oversized span id", `00-${TRACE_ID}-${"b".repeat(4096)}-01`],
    ["a sentinel-shaped trace id", `00-${LEAK}-${SPAN_ID}-01`],
    ["a sentinel-shaped span id", `00-${TRACE_ID}-${LEAK}-01`],
    ["a sentinel-shaped flags field", `00-${TRACE_ID}-${SPAN_ID}-${LEAK}`],
    ["a sentinel-shaped version", `${LEAK}-${TRACE_ID}-${SPAN_ID}-01`],
    ["a sentinel as the whole header", LEAK],
    ["an upper-case trace id", `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`],
    ["an upper-case span id", `00-${TRACE_ID}-${SPAN_ID.toUpperCase()}-01`],
    ["an all-zero trace id", `00-${"0".repeat(32)}-${SPAN_ID}-01`],
    ["an all-zero span id", `00-${TRACE_ID}-${"0".repeat(16)}-01`],
    ["a version other than 00", `01-${TRACE_ID}-${SPAN_ID}-01`],
    ["version ff", `ff-${TRACE_ID}-${SPAN_ID}-01`],
    ["a fifth field", `00-${TRACE_ID}-${SPAN_ID}-01-extra`],
    ["trailing text", `00-${TRACE_ID}-${SPAN_ID}-01 ${LEAK}`],
    ["a newline", `00-${TRACE_ID}-${SPAN_ID}-01\n${LEAK}`],
    ["a leading space", ` 00-${TRACE_ID}-${SPAN_ID}-01`],
    ["an empty header", ""],
  ])("takes no client trace id from a traceparent with %s, and starts an ordinary trace", (_name, traceparent) => {
    telemetry = installTestTelemetry();

    const extracted = propagation.extract(ROOT_CONTEXT, { traceparent, tracestate: HOSTILE_TRACESTATE });
    const span = startedUnder(extracted);

    expect(activeClientTraceId(extracted)).toBeUndefined();
    expect(trace.getSpanContext(extracted)).toBeUndefined();
    expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(telemetry.spans().map((exported) => exported.attributes["client.trace_id"])).toEqual([undefined]);
    expect(JSON.stringify(telemetry.spans().map((exported) => exported.attributes))).not.toContain(LEAK);
  });

  it("reads the first of several traceparent values and ignores the rest", () => {
    const propagator = new TraceparentOnlyPropagator();

    const extracted = propagator.extract(
      ROOT_CONTEXT,
      { traceparent: [`00-${TRACE_ID}-${SPAN_ID}-01`, `00-${"c".repeat(32)}-${SPAN_ID}-01`] },
      { keys: () => [], get: (carrier, key) => Reflect.get(Object(carrier), key) },
    );

    expect(activeClientTraceId(extracted)).toBe(TRACE_ID);
  });

  it("clears a client trace id the base context already had, so one request never inherits another's", () => {
    const propagator = new TraceparentOnlyPropagator();
    const getter = { keys: () => [], get: (carrier: unknown, key: string) => Reflect.get(Object(carrier), key) };
    const first = propagator.extract(ROOT_CONTEXT, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` }, getter);

    const second = propagator.extract(first, {}, getter);

    expect(activeClientTraceId(first)).toBe(TRACE_ID);
    expect(activeClientTraceId(second)).toBeUndefined();
  });

  it("removes an active span from the base context, so an extract at the boundary always begins a trace", () => {
    telemetry = installTestTelemetry();
    const outer = trace.getTracer("probe").startSpan("outer");
    const base = trace.setSpan(ROOT_CONTEXT, outer);

    const extracted = propagation.extract(base, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` });
    outer.end();

    expect(trace.getSpan(extracted)).toBeUndefined();
  });

  it("drops baggage too, since nothing else is registered", () => {
    telemetry = installTestTelemetry();

    const extracted = propagation.extract(ROOT_CONTEXT, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`, baggage: `answer=${HOSTILE_TRACESTATE}` });

    expect(propagation.getBaggage(extracted)).toBeUndefined();
  });

  it("leaves a context with no traceparent with no span and no client trace id", () => {
    const propagator = new TraceparentOnlyPropagator();

    const extracted = propagator.extract(ROOT_CONTEXT, {}, { keys: () => [], get: () => undefined });

    expect(trace.getSpanContext(extracted)).toBeUndefined();
    expect(activeClientTraceId(extracted)).toBeUndefined();
  });
});

describe("the propagator the pipeline registers: inject", () => {
  it("injects traceparent alone, whatever tracestate the span's context carries", () => {
    telemetry = installTestTelemetry();
    const withState = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
      traceState: createTraceState("vendor=hostile"),
    });
    const carrier: Record<string, string> = {};

    propagation.inject(withState, carrier);

    expect(carrier).toEqual({ traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` });
    expect(propagation.fields()).toEqual(["traceparent"]);
  });

  it("injects nothing for a context with no span, and never a client trace id", () => {
    const propagator = new TraceparentOnlyPropagator();
    const carrier: Record<string, string> = {};
    const inbound = propagator.extract(ROOT_CONTEXT, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` }, { keys: () => [], get: (source, key) => Reflect.get(Object(source), key) });

    propagator.inject(inbound, carrier, { set: (target, key, value) => void (target[key] = value) });

    expect(carrier).toEqual({});
  });
});

describe("the barrier that keeps a caller's tracestate and trace id out of the SQL comment", () => {
  const inboundCarrier = { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`, tracestate: HOSTILE_TRACESTATE };

  function commentFor(extracted: Context): string {
    return addSqlCommenterComment(startedUnder(extracted), "SELECT 1");
  }

  it("holds: a span started under a context the registered propagator extracted gives a comment with its own traceparent alone", () => {
    telemetry = installTestTelemetry();

    const commented = commentFor(propagation.extract(ROOT_CONTEXT, inboundCarrier));

    expect(commented).toMatch(/^SELECT 1 \/\*traceparent='00-[0-9a-f]{32}-[0-9a-f]{16}-01'\*\/$/);
    expect(commented).not.toContain(TRACE_ID);
    expect(commented).not.toContain(SPAN_ID);
    expect(commented).not.toContain("tracestate");
    expect(commented).not.toContain("vendor");
    expect(commented).not.toContain(LEAK);
  });

  it("is the extract side, because the comment is built by the instrumentation's own propagator: a stock W3C extract puts tracestate in it", () => {
    telemetry = installTestTelemetry();

    const commented = commentFor(new W3CTraceContextPropagator().extract(ROOT_CONTEXT, inboundCarrier, defaultTextMapGetter));

    expect(commented).toContain("tracestate=");
  });
});
