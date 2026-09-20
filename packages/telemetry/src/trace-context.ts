export const TRACEPARENT_HEADER = "traceparent";

export const TRACEPARENT_VERSION = "00";

export const TRACE_ID_LENGTH = 32;

export const SPAN_ID_LENGTH = 16;

export const TRACE_FLAGS_LENGTH = 2;

const TRACEPARENT_SHAPE = new RegExp(
  `^${TRACEPARENT_VERSION}-([0-9a-f]{${TRACE_ID_LENGTH}})-([0-9a-f]{${SPAN_ID_LENGTH}})-([0-9a-f]{${TRACE_FLAGS_LENGTH}})$`,
);

export const ALL_ZERO = /^0+$/;

const BYTE_VALUES = 256;

interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
}

export function formatTraceparent(traceId: string, spanId: string, traceFlags: number): string {
  const flags = (traceFlags % BYTE_VALUES).toString(16).padStart(TRACE_FLAGS_LENGTH, "0");
  return `${TRACEPARENT_VERSION}-${traceId}-${spanId}-${flags}`;
}

export function parseTraceparent(value: unknown): TraceContext | undefined {
  const parts = typeof value === "string" ? TRACEPARENT_SHAPE.exec(value) : null;
  const [, traceId, spanId, flags] = parts ?? [];
  if (traceId === undefined || spanId === undefined || flags === undefined) return undefined;
  if (ALL_ZERO.test(traceId) || ALL_ZERO.test(spanId)) return undefined;
  return { traceId, spanId, traceFlags: Number.parseInt(flags, 16) };
}
