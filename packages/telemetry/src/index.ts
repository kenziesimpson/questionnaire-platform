export { emitDomainEvent, type DomainEvent } from "./events.js";
export {
  FIELDS,
  OUTCOMES,
  type FieldName,
  type FieldValue,
  type Outcome,
  type TelemetryContext,
} from "./fields.js";
export { ingestBatch } from "./ingest.js";
export { LOG_LEVELS, logger, type LiteralMessage, type LogLevel, type Logger, type LogMethod } from "./logger.js";
export { scrubAttributes, scrubContext, type DropCounts, type ScrubResult } from "./scrub.js";
export { problemTelemetry } from "./problem-telemetry.js";
export { findingTotals, MAX_FINDINGS, tallyCodes, type FindingTotals } from "./problems.js";
export { activeTraceId, annotateActiveSpan, withSpan, type SpanName } from "./spans.js";
export { DROP_REASONS, SIGNAL_KINDS, type DropReason, type SignalKind } from "./vocabulary.js";
