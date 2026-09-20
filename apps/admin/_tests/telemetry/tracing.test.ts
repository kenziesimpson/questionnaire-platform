import { withSpan } from "@qp/telemetry";
import { injectTraceHeaders } from "@qp/telemetry/browser";
import { stopBrowserTracing } from "@qp/telemetry/browser-tracing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTracingWhenEnabled } from "../../src/telemetry/tracing";

afterEach(async () => {
  vi.unstubAllEnvs();
  await stopBrowserTracing();
});

async function traceparentInsideASpan(): Promise<string | undefined> {
  let traceparent: string | undefined;
  await withSpan("browser.request", { method: "GET", route: "/api/reporting/questionnaires/:id/responses/:sessionId" }, async () => {
    traceparent = injectTraceHeaders().traceparent;
  });
  return traceparent;
}

describe("startTracingWhenEnabled", () => {
  it("starts the web tracer when the build enables it, so a request inside a span carries a traceparent", async () => {
    vi.stubEnv("VITE_TELEMETRY_TRACING", "true");

    await startTracingWhenEnabled();

    expect(await traceparentInsideASpan()).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  });

  it.each(["", "false", "1"])("does nothing when the build sets it to %j, so no span carries ids", async (value) => {
    vi.stubEnv("VITE_TELEMETRY_TRACING", value);

    await startTracingWhenEnabled();

    expect(await traceparentInsideASpan()).toBeUndefined();
  });
});
