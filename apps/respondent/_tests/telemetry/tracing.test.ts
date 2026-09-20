import { withSpan } from "@qp/telemetry";
import { injectTraceHeaders } from "@qp/telemetry/browser";
import { stopBrowserTracing } from "@qp/telemetry/browser-tracing";
import { afterEach, describe, expect, it } from "vitest";
import { startTracingWhenEnabled } from "../../src/telemetry/tracing";

afterEach(async () => {
  await stopBrowserTracing();
});

async function traceparentInsideASpan(): Promise<string | undefined> {
  let traceparent: string | undefined;
  await withSpan("browser.request", { method: "GET", route: "/api/run/sessions/:sessionId" }, async () => {
    traceparent = injectTraceHeaders().traceparent;
  });
  return traceparent;
}

describe("startTracingWhenEnabled", () => {
  it("starts the web tracer when enabled, so a request inside a span carries a traceparent", async () => {
    await startTracingWhenEnabled(true);

    expect(await traceparentInsideASpan()).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  });

  it("does nothing when not enabled, so no span carries ids", async () => {
    await startTracingWhenEnabled(false);

    expect(await traceparentInsideASpan()).toBeUndefined();
  });
});
