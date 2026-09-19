import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDatabase } from "../db/fixtures.js";

const testDatabase = useTestDatabase();

const EXPORTERS = fileURLToPath(new URL("../../../../packages/telemetry/dist/exporters.js", import.meta.url));

const REAL_APP_FLOW = "500 path";

beforeEach(() => {
  vi.resetModules();
  vi.doMock(EXPORTERS, async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    scrubbingSpanExporter: (exporter: unknown) => exporter,
    scrubbingMetricExporter: (exporter: unknown) => exporter,
  }));
});

afterEach(() => {
  vi.doUnmock(EXPORTERS);
  vi.resetModules();
});

describe("TELEMETRY LEAK TEST mutation check: with the export-time scrub removed, a real-app flow fails the gate", () => {
  it("detects the sentinel in a span Fastify's instrumentation produced, not only in a planted one", async () => {
    const { LEAK_FLOWS } = await import("./flows.js");
    const { runOnLeakApp } = await import("./harness.js");
    const { expectCleanRun } = await import("@qp/telemetry/leak-test");
    const flow = LEAK_FLOWS.find((candidate) => candidate.name.startsWith(REAL_APP_FLOW));
    expect(flow, "the real-app flow this check runs must still be registered").toBeDefined();
    if (flow === undefined) return;

    const run = await runOnLeakApp(testDatabase, flow, { autoInstrumentation: true });

    expect(run.spanNames).toContain("request");
    expect(run.exposures.length).toBeGreaterThan(0);
    expect(new Set(run.exposures.map((exposure) => exposure.signal))).toEqual(new Set(["span"]));
    expect(run.exposures.map((exposure) => exposure.name)).toContain("request");
    expect(() => expectCleanRun(flow.name, run)).toThrow(/TELEMETRY LEAK TEST FAILED/);
  });
});
