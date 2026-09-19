export const INSTRUMENTATION_SCOPE = "qp.telemetry";

export const SIGNAL_KINDS = ["log", "span", "metric"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const DROP_REASONS = ["unknown", "invalid", "unbounded", "internal"] as const;
export type DropReason = (typeof DROP_REASONS)[number];

export const INGEST_DROP_REASONS = [
  "malformed",
  "unknown_event",
  "unknown_field",
  "invalid_field",
  "invalid_trace",
  "over_limit",
] as const;
export type IngestDropReason = (typeof INGEST_DROP_REASONS)[number];

export const SCRUB_ATTRIBUTES = {
  signal: "telemetry.signal",
  reason: "telemetry.reason",
  ingestReason: "telemetry.ingest_reason",
} as const;

export const EVENT_SOURCES = ["browser"] as const;

export const CLIENT_LOG_EVENTS = ["client.info", "client.warn", "client.error"] as const;
export type ClientLogEvent = (typeof CLIENT_LOG_EVENTS)[number];

export const CLIENT_LOG_LEVELS = { "client.info": "info", "client.warn": "warn", "client.error": "error" } as const satisfies Record<
  ClientLogEvent,
  "info" | "warn" | "error"
>;

export const LOG_ATTRIBUTES = { traceId: "trace_id", spanId: "span_id", module: "module" } as const;

export const LOG_MODULES = ["backend", "browser", "definition", "events", "execution", "http"] as const;
export type LogModule = (typeof LOG_MODULES)[number];

export const EVENTS_LOG_MODULE = "events" satisfies LogModule;
