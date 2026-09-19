import { ExportResultCode } from "@opentelemetry/core";
import type { Attributes } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { AggregationTemporality, InMemoryMetricExporter, type ScopeMetrics } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withSpan } from "../src/index.js";
import { scrubbingMetricExporter, scrubbingSpanExporter } from "../src/exporters.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { internalDropsIn } from "./faults.js";
import { SESSION_ID } from "./fixtures.js";

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
});

describe("the scrubbing exporters never throw and never export a batch they could not scrub", () => {
  it("fails the span batch, exports nothing and counts one internal span drop when a span's attributes cannot be read", async () => {
    telemetry = installTestTelemetry();
    await withSpan("session.submit", { sessionId: SESSION_ID }, async () => undefined);
    const [real] = telemetry.spans();
    if (real === undefined) throw new Error("the real span is missing");
    const hostile = {
      ...real,
      get attributes(): Attributes {
        throw new Error("hostile attributes");
      },
    };
    const delegate = new InMemorySpanExporter();
    const callback = vi.fn();
    expect(() => {
      scrubbingSpanExporter(delegate).export([hostile], callback);
    }).not.toThrow();
    expect(callback).toHaveBeenCalledExactlyOnceWith({ code: ExportResultCode.FAILED });
    expect(delegate.getFinishedSpans()).toEqual([]);
    expect(await internalDropsIn(telemetry)).toEqual({ span: 1 });
  });

  it("fails the metric batch, exports nothing and counts one internal metric drop when a scope's metrics cannot be read", async () => {
    telemetry = installTestTelemetry();
    const scope = {
      scope: { name: "probe" },
      get metrics(): ScopeMetrics["metrics"] {
        throw new Error("hostile metrics");
      },
    };
    const delegate = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const callback = vi.fn();
    expect(() => {
      scrubbingMetricExporter(delegate).export({ resource: resourceFromAttributes({}), scopeMetrics: [scope] }, callback);
    }).not.toThrow();
    expect(callback).toHaveBeenCalledExactlyOnceWith({ code: ExportResultCode.FAILED });
    expect(delegate.getMetrics()).toEqual([]);
    expect(await internalDropsIn(telemetry)).toEqual({ metric: 1 });
  });
});
