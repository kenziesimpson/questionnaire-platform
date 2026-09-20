import { trace, type Context, type TextMapGetter, type TextMapSetter } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { clientTraceIdOf, startingTrace } from "./client-trace.js";
import { TRACEPARENT_HEADER } from "./trace-context.js";

function withoutTraceState(context: Context): Context {
  const spanContext = trace.getSpanContext(context);
  if (spanContext === undefined || spanContext.traceState === undefined) return context;
  return trace.setSpanContext(context, { ...spanContext, traceState: undefined });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export class TraceparentOnlyPropagator extends W3CTraceContextPropagator {
  override inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    super.inject(withoutTraceState(context), carrier, setter);
  }

  override extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    return startingTrace(context, clientTraceIdOf(firstHeader(getter.get(carrier, TRACEPARENT_HEADER))));
  }

  override fields(): string[] {
    return [TRACEPARENT_HEADER];
  }
}
