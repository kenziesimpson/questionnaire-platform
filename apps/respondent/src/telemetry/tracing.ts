export async function startTracingWhenEnabled(): Promise<void> {
  if (import.meta.env.VITE_TELEMETRY_TRACING === "true") {
    try {
      const { startBrowserTracing } = await import("@qp/telemetry/browser-tracing");
      startBrowserTracing();
    } catch {
      return;
    }
  }
}
