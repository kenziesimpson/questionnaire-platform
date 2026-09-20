import { context, trace } from "@opentelemetry/api";
import { StackContextManager, WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { guarded, guardedAsync } from "../guard.js";

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
