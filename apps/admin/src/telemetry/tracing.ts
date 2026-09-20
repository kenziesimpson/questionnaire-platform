export async function startTracingWhenEnabled(enabled: boolean): Promise<void> {
  if (!enabled) return;
  try {
    const { startBrowserTracing } = await import("@qp/telemetry/browser-tracing");
    startBrowserTracing();
  } catch {
    return;
  }
}
