import { context, createTraceState, defaultTextMapGetter, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { addSqlCommenterComment } from "@opentelemetry/sql-common";
import { afterEach, describe, expect, it } from "vitest";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { TraceparentOnlyPropagator } from "../src/trace-propagator.js";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const HOSTILE_TRACESTATE = `vendor=LEAK_DIABETES_8F3A,${"k".repeat(200)}=${"v".repeat(250)}`;

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
});

describe("the propagator the pipeline registers", () => {
  it("extracts the trace and span ids and the sampled flag from traceparent and ignores tracestate", () => {
    telemetry = installTestTelemetry();

    const extracted = propagation.extract(ROOT_CONTEXT, {
      traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
      tracestate: HOSTILE_TRACESTATE,
    });

    expect(trace.getSpanContext(extracted)).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1, isRemote: true, traceState: undefined });
  });

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

  it("carries no tracestate into a span started under an inbound context that had one", () => {
    telemetry = installTestTelemetry();
    const inbound = propagation.extract(ROOT_CONTEXT, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`, tracestate: HOSTILE_TRACESTATE });

    const child = context.with(inbound, () => trace.getTracer("probe").startSpan("child"));
    child.end();

    expect(child.spanContext().traceId).toBe(TRACE_ID);
    expect(child.spanContext().traceState).toBeUndefined();
  });

  it("drops baggage too, since nothing else is registered", () => {
    telemetry = installTestTelemetry();

    const extracted = propagation.extract(ROOT_CONTEXT, { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`, baggage: `answer=${HOSTILE_TRACESTATE}` });

    expect(propagation.getBaggage(extracted)).toBeUndefined();
  });

  it("leaves a context with no span as it was", () => {
    const propagator = new TraceparentOnlyPropagator();
    const carrier: Record<string, string> = {};

    propagator.inject(ROOT_CONTEXT, carrier, { set: (target, key, value) => void (target[key] = value) });

    expect(carrier).toEqual({});
    expect(propagator.extract(ROOT_CONTEXT, {}, { keys: () => [], get: () => undefined })).toBe(ROOT_CONTEXT);
  });
});

describe("the barrier that keeps a caller's tracestate out of the SQL comment", () => {
  const inboundCarrier = { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`, tracestate: HOSTILE_TRACESTATE };

  function commentFor(extracted: ReturnType<typeof propagation.extract>): string {
    const span = context.with(extracted, () => trace.getTracer("probe").startSpan("query"));
    span.end();
    return addSqlCommenterComment(span, "SELECT 1");
  }

  it("holds: a span started under a context the registered propagator extracted gives a comment with traceparent alone", () => {
    telemetry = installTestTelemetry();

    const commented = commentFor(propagation.extract(ROOT_CONTEXT, inboundCarrier));

    expect(commented).toMatch(new RegExp(`^SELECT 1 /\\*traceparent='00-${TRACE_ID}-[0-9a-f]{16}-01'\\*/$`));
    expect(commented).not.toContain("tracestate");
    expect(commented).not.toContain("vendor");
  });

  it("is the extract side, because the comment is built by the instrumentation's own propagator: a stock W3C extract puts tracestate in it", () => {
    telemetry = installTestTelemetry();

    const commented = commentFor(new W3CTraceContextPropagator().extract(ROOT_CONTEXT, inboundCarrier, defaultTextMapGetter));

    expect(commented).toContain("tracestate=");
  });
});

