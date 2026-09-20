import { context as activeContext, createContextKey, trace, type Context } from "@opentelemetry/api";
import { FIELDS } from "./fields.js";
import { parseTraceparent } from "./trace-context.js";

const CLIENT_TRACE = createContextKey("qp.client_trace");

interface ClientTrace {
  readonly traceId: string;
}

function isClientTrace(value: unknown): value is ClientTrace {
  return typeof value === "object" && value !== null && FIELDS.clientTraceId.accepts(Reflect.get(value, "traceId"));
}

export function clientTraceIdOf(traceparent: unknown): string | undefined {
  return parseTraceparent(traceparent)?.traceId;
}

export function withClientTrace(base: Context, clientTraceId: string | undefined): Context {
  const cleared = base.deleteValue(CLIENT_TRACE);
  return clientTraceId === undefined ? cleared : cleared.setValue(CLIENT_TRACE, { traceId: clientTraceId } satisfies ClientTrace);
}

export function startingTrace(base: Context, clientTraceId: string | undefined): Context {
  return withClientTrace(trace.deleteSpan(base), clientTraceId);
}

export function activeClientTraceId(within: Context = activeContext.active()): string | undefined {
  const stored = within.getValue(CLIENT_TRACE);
  return isClientTrace(stored) ? stored.traceId : undefined;
}
