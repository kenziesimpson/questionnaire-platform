import type { LogLevel } from "./logger.js";

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

export const LOG_MESSAGE_SHAPE = /^[A-Za-z][A-Za-z0-9 ._:,/-]{0,127}$/;

export const UNNAMED_LOG_MESSAGE = "unnamed";

export const EVENT_SOURCES = ["browser"] as const;

export const CLIENT_LOG_LEVELS = ["info", "warn", "error"] as const satisfies readonly LogLevel[];
export type ClientLogLevel = (typeof CLIENT_LOG_LEVELS)[number];

export type ClientLogEvent = `client.${ClientLogLevel}`;

export function clientLogEventOf(level: ClientLogLevel): ClientLogEvent {
  return `client.${level}`;
}

export function clientLogLevelOf(name: unknown): ClientLogLevel | undefined {
  return CLIENT_LOG_LEVELS.find((level) => clientLogEventOf(level) === name);
}

export const LOG_ATTRIBUTES = { traceId: "trace_id", spanId: "span_id", module: "module" } as const;

export const LOG_MODULES = ["backend", "browser", "definition", "events", "execution", "http"] as const;
export type LogModule = (typeof LOG_MODULES)[number];

export const EVENTS_LOG_MODULE = "events" satisfies LogModule;
