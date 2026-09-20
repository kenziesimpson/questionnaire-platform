import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { guarded } from "./guard.js";
import type { LogLevel, LogSink } from "./logger.js";
import { INSTRUMENTATION_SCOPE, LOG_ATTRIBUTES } from "./vocabulary.js";

export const LOG_SEVERITIES = {
  debug: { number: SeverityNumber.DEBUG, text: "DEBUG" },
  info: { number: SeverityNumber.INFO, text: "INFO" },
  warn: { number: SeverityNumber.WARN, text: "WARN" },
  error: { number: SeverityNumber.ERROR, text: "ERROR" },
} as const satisfies Record<LogLevel, { readonly number: SeverityNumber; readonly text: string }>;

const CARRIED_BY_THE_TRACE_CONTEXT: readonly string[] = [LOG_ATTRIBUTES.traceId, LOG_ATTRIBUTES.spanId];

export function alsoEmittingLogRecords(write: LogSink): LogSink {
  return (record) => {
    write(record);
    guarded("log", () => {
      const severity = LOG_SEVERITIES[record.level];
      logs.getLogger(INSTRUMENTATION_SCOPE).emit({
        severityNumber: severity.number,
        severityText: severity.text,
        body: record.message,
        attributes: Object.fromEntries(Object.entries(record.attributes).filter(([key]) => !CARRIED_BY_THE_TRACE_CONTEXT.includes(key))),
      });
    });
  };
}
