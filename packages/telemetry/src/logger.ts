import { trace } from "@opentelemetry/api";
import { stackFramesOf, type TelemetryContext } from "./fields.js";
import { guarded } from "./guard.js";
import { reportDropped } from "./instruments.js";
import { scrubAttributes, scrubContext, type ScrubbedAttributes } from "./scrub.js";
import { LOG_ATTRIBUTES, type LogModule } from "./vocabulary.js";

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

export function configureLogging(settings: { readonly level: LogLevel; readonly sink: LogSink | undefined }): void {
  state.threshold = settings.level;
  state.sink = settings.sink;
}

export function resetLogging(): void {
  configureLogging({ level: DEFAULT_LOG_LEVEL, sink: undefined });
}

function isBelowThreshold(level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(state.threshold);
}

function correlation(): Record<string, string> {
  const context = trace.getActiveSpan()?.spanContext();
  return context === undefined ? {} : { [LOG_ATTRIBUTES.traceId]: context.traceId, [LOG_ATTRIBUTES.spanId]: context.spanId };
}

function emit(level: LogLevel, module: string, message: string, context: unknown, error: Error | undefined): void {
  const sink = state.sink;
  if (sink === undefined || isBelowThreshold(level)) return;
  const fields = scrubContext({
    ...(typeof context === "object" ? context : undefined),
    ...(error === undefined ? {} : { errorType: error.name, errorStack: stackFramesOf(error) }),
  });
  const record = scrubAttributes({ ...fields.attributes, [LOG_ATTRIBUTES.module]: module, ...correlation() }, "log");
  reportDropped("log", fields.dropped);
  reportDropped("log", record.dropped);
  sink({ level, message, attributes: record.attributes });
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
