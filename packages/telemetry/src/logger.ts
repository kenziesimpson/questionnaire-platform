import { trace } from "@opentelemetry/api";
import { stackFramesOf, type TelemetryContext } from "./fields.js";
import { reportDropped } from "./instruments.js";
import { scrubAttributes, scrubContext, type ScrubbedAttributes } from "./scrub.js";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LiteralMessage<M extends string> = {} extends Record<M, 1> ? never : M;

interface LogRecord {
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

const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

const state: { threshold: LogLevel; sink: LogSink | undefined } = { threshold: "info", sink: undefined };

export function configureLogging(settings: { readonly level: LogLevel; readonly sink: LogSink | undefined }): void {
  state.threshold = settings.level;
  state.sink = settings.sink;
}

function correlation(): Record<string, string> {
  const context = trace.getActiveSpan()?.spanContext();
  return context === undefined ? {} : { trace_id: context.traceId, span_id: context.spanId };
}

function emit(level: LogLevel, module: string, message: string, context: unknown, error: Error | undefined): void {
  const sink = state.sink;
  if (sink === undefined || RANK[level] < RANK[state.threshold]) return;
  const fields = scrubContext({
    ...(typeof context === "object" ? context : undefined),
    ...(error === undefined ? {} : { errorType: error.name, errorStack: stackFramesOf(error) }),
  });
  const record = scrubAttributes({ ...fields.attributes, module, ...correlation() }, "log");
  reportDropped("log", fields.dropped);
  reportDropped("log", record.dropped);
  sink({ level, message, attributes: record.attributes });
}

export function logger<N extends string>(module: LiteralMessage<N>): Logger {
  const method =
    (level: LogLevel): LogMethod =>
    (message, context, error) => {
      emit(level, module, message, context, error);
    };
  return { debug: method("debug"), info: method("info"), warn: method("warn"), error: method("error") };
}
