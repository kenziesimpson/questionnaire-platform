import { isSpanContextValid, SpanStatusCode, trace } from "@opentelemetry/api";
import type { TelemetryContext } from "./fields.js";
import { reportDropped } from "./instruments.js";
import { oneDropped, scrubContext } from "./scrub.js";
import { INSTRUMENTATION_SCOPE } from "./vocabulary.js";

export const SPAN_NAMES = ["questionnaire.publish", "rule.evaluate", "session.submit"] as const;
export type SpanName = (typeof SPAN_NAMES)[number];

export function isSpanName(name: unknown): name is SpanName {
  return SPAN_NAMES.some((known) => known === name);
}

export function activeTraceId(): string | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  return context !== undefined && isSpanContextValid(context) ? context.traceId : undefined;
}

export function annotateActiveSpan(context: TelemetryContext, error?: Error): void {
  const span = trace.getActiveSpan();
  if (span === undefined) return;
  const fields = scrubContext({ ...context, ...(error === undefined ? {} : { errorType: error.name }) });
  reportDropped("span", fields.dropped);
  span.setAttributes(fields.attributes);
}

export async function withSpan<T>(name: SpanName, context: TelemetryContext, fn: () => Promise<T>): Promise<T> {
  if (!isSpanName(name)) {
    reportDropped("span", oneDropped("unknown"));
    return fn();
  }
  const fields = scrubContext(context);
  reportDropped("span", fields.dropped);
  return trace.getTracer(INSTRUMENTATION_SCOPE).startActiveSpan(name, { attributes: fields.attributes }, async (span) => {
    try {
      return await fn();
    } catch (error) {
      const failure = scrubContext({ errorType: error instanceof Error ? error.name : undefined });
      span.setAttributes(failure.attributes);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
