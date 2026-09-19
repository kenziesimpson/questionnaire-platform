import { context, isSpanContextValid, trace } from "@opentelemetry/api";
import { StackContextManager, WebTracerProvider } from "@opentelemetry/sdk-trace-web";

const TRACEPARENT = "traceparent";

const TRACEPARENT_VERSION = "00";

let provider: WebTracerProvider | undefined;

export function startBrowserTracing(): void {
  if (provider !== undefined) return;
  const created = new WebTracerProvider();
  trace.setGlobalTracerProvider(created);
  context.setGlobalContextManager(new StackContextManager().enable());
  provider = created;
}

export async function stopBrowserTracing(): Promise<void> {
  const stopped = provider;
  provider = undefined;
  trace.disable();
  context.disable();
  await stopped?.shutdown();
}

function withoutTraceparent(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== TRACEPARENT));
}

export function injectTraceHeaders(headers: Readonly<Record<string, string>> = {}): Record<string, string> {
  const active = trace.getActiveSpan()?.spanContext();
  if (active === undefined || !isSpanContextValid(active)) return withoutTraceparent(headers);
  const flags = active.traceFlags.toString(16).padStart(2, "0");
  return { ...withoutTraceparent(headers), [TRACEPARENT]: `${TRACEPARENT_VERSION}-${active.traceId}-${active.spanId}-${flags}` };
}
