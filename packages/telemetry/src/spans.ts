import { context as activeContext, isSpanContextValid, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import type { TelemetryContext } from "./fields.js";
import { guarded, guardedOr } from "./guard.js";
import { reportDropped } from "./instruments.js";
import { oneDropped, scrubContext } from "./scrub.js";
import { INSTRUMENTATION_SCOPE } from "./vocabulary.js";

export const SPAN_NAMES = [
  "browser.request",
  "questionnaire.create",
  "questionnaire.edit_draft",
  "questionnaire.open_draft",
  "questionnaire.publish",
  "questionnaire.retire",
  "reporting.list_sessions",
  "reporting.session_detail",
  "rule.evaluate",
  "session.submit",
  "telemetry.ingest",
] as const;
export type SpanName = (typeof SPAN_NAMES)[number];

export function isSpanName(name: unknown): name is SpanName {
  return SPAN_NAMES.some((known) => known === name);
}

export function activeTraceId(): string | undefined {
  return guardedOr<string | undefined>("span", undefined, () => {
    const context = trace.getActiveSpan()?.spanContext();
    return context !== undefined && isSpanContextValid(context) ? context.traceId : undefined;
  });
}

export function annotateActiveSpan(context: TelemetryContext, error?: Error): void {
  guarded("span", () => {
    const span = trace.getActiveSpan();
    if (span === undefined) return;
    const fields = scrubContext({ ...context, ...(error === undefined ? {} : { errorType: error.name }) });
    reportDropped("span", fields.dropped);
    span.setAttributes(fields.attributes);
  });
}

function beginSpan(name: SpanName, context: TelemetryContext): Span | undefined {
  return guardedOr<Span | undefined>("span", undefined, () => {
    const fields = scrubContext(context);
    reportDropped("span", fields.dropped);
    return trace.getTracer(INSTRUMENTATION_SCOPE).startSpan(name, { attributes: fields.attributes });
  });
}

function markFailed(span: Span, error: unknown): void {
  guarded("span", () => {
    span.setStatus({ code: SpanStatusCode.ERROR });
  });
  guarded("span", () => {
    const failure = scrubContext({ errorType: error instanceof Error ? error.name : undefined });
    span.setAttributes(failure.attributes);
  });
}

function endSpan(span: Span): void {
  guarded("span", () => {
    span.end();
  });
}

export async function withSpan<T>(name: SpanName, context: TelemetryContext, fn: () => Promise<T>): Promise<T> {
  if (!isSpanName(name)) {
    reportDropped("span", oneDropped("unknown"));
    return fn();
  }
  const span = beginSpan(name, context);
  if (span === undefined) return fn();
  const call = { started: false };
  try {
    return await activeContext.with(trace.setSpan(activeContext.active(), span), () => {
      call.started = true;
      return fn();
    });
  } catch (error) {
    if (!call.started) {
      reportDropped("span", oneDropped("internal"));
      return await fn();
    }
    markFailed(span, error);
    throw error;
  } finally {
    endSpan(span);
  }
}
