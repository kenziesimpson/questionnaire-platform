export const INSTRUMENTATION_SCOPE = "qp.telemetry";

export const SIGNAL_KINDS = ["log", "span", "metric"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const DROP_REASONS = ["unknown", "invalid", "unbounded"] as const;
export type DropReason = (typeof DROP_REASONS)[number];

export const SCRUB_ATTRIBUTES = { signal: "telemetry.signal", reason: "telemetry.reason" } as const;

export const LOG_ATTRIBUTES = { traceId: "trace_id", spanId: "span_id", module: "module" } as const;
