import { trace, type Context, type TextMapGetter, type TextMapSetter } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { TRACEPARENT_HEADER } from "./trace-context.js";

function withoutTraceState(context: Context): Context {
  const spanContext = trace.getSpanContext(context);
  if (spanContext === undefined || spanContext.traceState === undefined) return context;
  return trace.setSpanContext(context, { ...spanContext, traceState: undefined });
}

export class TraceparentOnlyPropagator extends W3CTraceContextPropagator {
  override inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    super.inject(withoutTraceState(context), carrier, setter);
  }

  override extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    return withoutTraceState(super.extract(context, carrier, getter));
  }

  override fields(): string[] {
    return [TRACEPARENT_HEADER];
  }
}
