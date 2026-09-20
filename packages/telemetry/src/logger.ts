import { trace } from "@opentelemetry/api";
import { activeClientTraceId } from "./client-trace.js";
import { FIELDS, stackFramesOf, type TelemetryContext } from "./fields.js";
import { guarded, guardedOr } from "./guard.js";
import { reportDropped } from "./instruments.js";
import { scrubAttributes, scrubContext, type ScrubbedAttributes } from "./scrub.js";
import { EVENTS_LOG_MODULE, LOG_ATTRIBUTES, type LogModule } from "./vocabulary.js";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LiteralMessage<M extends string> = {} extends Record<M, 1> ? never : M;

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly attributes: ScrubbedAttributes;
}

export type LogSink = (record: LogRecord) => void;

export interface LogMethod {
  <M extends string>(message: LiteralMessage<M>, context?: TelemetryContext, error?: Error): void;
}

export interface Logger {
  readonly debug: LogMethod;
  readonly info: LogMethod;
  readonly warn: LogMethod;
  readonly error: LogMethod;
}

const DEFAULT_LOG_LEVEL: LogLevel = "info";

const state: { threshold: LogLevel; sink: LogSink | undefined } = { threshold: DEFAULT_LOG_LEVEL, sink: undefined };

interface LoggingSettings {
  readonly level: LogLevel;
  readonly sink: LogSink | undefined;
}

export function configureLogging(settings: LoggingSettings): void {
  state.threshold = settings.level;
  state.sink = settings.sink;
}

export function currentLogging(): LoggingSettings {
  return { level: state.threshold, sink: state.sink };
}

export function resetLogging(): void {
  configureLogging({ level: DEFAULT_LOG_LEVEL, sink: undefined });
}

function isBelowThreshold(level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(state.threshold);
}

function correlation(): Record<string, string> {
  const context = trace.getActiveSpan()?.spanContext();
  const clientTraceId = activeClientTraceId();
  return {
    ...(context === undefined ? {} : { [LOG_ATTRIBUTES.traceId]: context.traceId, [LOG_ATTRIBUTES.spanId]: context.spanId }),
    ...(clientTraceId === undefined ? {} : { [FIELDS.clientTraceId.attribute]: clientTraceId }),
  };
}

const domainEventRecords = new WeakSet<object>();

export function isDomainEventRecord(record: object): boolean {
  return domainEventRecords.has(record);
}

function emit(
  level: LogLevel,
  module: string,
  message: string,
  context: unknown,
  error: Error | undefined,
  isDomainEvent = false,
): void {
  const sink = state.sink;
  if (sink === undefined || isBelowThreshold(level)) return;
  const fields = scrubContext({
    ...(typeof context === "object" ? context : undefined),
    ...(error === undefined ? {} : { errorType: error.name, errorStack: stackFramesOf(error) }),
  });
  const record = scrubAttributes({ ...fields.attributes, [LOG_ATTRIBUTES.module]: module, ...correlation() }, "log");
  reportDropped("log", fields.dropped);
  reportDropped("log", record.dropped);
  const logRecord: LogRecord = { level, message, attributes: record.attributes };
  if (isDomainEvent) domainEventRecords.add(logRecord);
  sink(logRecord);
}

export function logDomainEvent<M extends string>(message: LiteralMessage<M>, context: TelemetryContext): void {
  guarded("log", () => {
    emit("info", EVENTS_LOG_MODULE, message, context, undefined, true);
  });
}

export function relayLog<M extends string>(
  level: LogLevel,
  module: LogModule,
  message: LiteralMessage<M>,
  context: Readonly<Record<string, unknown>>,
): boolean {
  return guardedOr("log", false, () => {
    emit(level, module, message, context, undefined);
    return true;
  });
}

export function logger(module: LogModule): Logger {
  const method =
    (level: LogLevel): LogMethod =>
    (message, context, error) => {
      guarded("log", () => {
        emit(level, module, message, context, error);
      });
    };
  return { debug: method("debug"), info: method("info"), warn: method("warn"), error: method("error") };
}
