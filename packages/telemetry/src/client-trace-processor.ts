import { trace, type Context } from "@opentelemetry/api";
import type { Span, SpanProcessor } from "@opentelemetry/sdk-trace";
import { activeClientTraceId } from "./client-trace.js";
import { FIELDS } from "./fields.js";
import { guarded } from "./guard.js";

export class ClientTraceSpanProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    guarded("span", () => {
      const clientTraceId = activeClientTraceId(parentContext);
      if (clientTraceId === undefined || trace.getSpan(parentContext) !== undefined) return;
      span.setAttribute(FIELDS.clientTraceId.attribute, clientTraceId);
    });
  }

  onEnd(): void {
    return;
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
