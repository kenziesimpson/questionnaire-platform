import { context, isSpanContextValid, trace } from "@opentelemetry/api";
import { StackContextManager, WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { guarded, guardedAsync, guardedOr } from "../guard.js";
import { formatTraceparent, TRACEPARENT_HEADER } from "../trace-context.js";

let provider: WebTracerProvider | undefined;

export function startBrowserTracing(): void {
  guarded("span", () => {
    if (provider !== undefined) return;
    const created = new WebTracerProvider();
    trace.setGlobalTracerProvider(created);
    try {
      context.setGlobalContextManager(new StackContextManager().enable());
    } catch (failure) {
      trace.disable();
      throw failure;
    }
    provider = created;
  });
}

export async function stopBrowserTracing(): Promise<void> {
  const stopped = provider;
  provider = undefined;
  guarded("span", () => {
    trace.disable();
  });
  guarded("span", () => {
    context.disable();
  });
  await guardedAsync("span", async () => {
    await stopped?.shutdown();
  });
}

function withoutTraceparent(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== TRACEPARENT_HEADER));
}

export function activeTraceparent(): string | undefined {
  return guardedOr<string | undefined>("span", undefined, () => {
    const active = trace.getActiveSpan()?.spanContext();
    return active === undefined || !isSpanContextValid(active) ? undefined : formatTraceparent(active.traceId, active.spanId, active.traceFlags);
  });
}

export function injectTraceHeaders(headers: Readonly<Record<string, string>> = {}): Record<string, string> {
  const traceparent = activeTraceparent();
  const others = withoutTraceparent(headers);
  return traceparent === undefined ? others : { ...others, [TRACEPARENT_HEADER]: traceparent };
}
