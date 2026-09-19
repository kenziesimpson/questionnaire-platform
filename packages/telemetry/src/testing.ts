import { Writable } from "node:stream";
import { AggregationTemporality, InMemoryMetricExporter, type MetricData } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace";
import type { LogLevel } from "./logger.js";
import { startPipeline } from "./pipeline.js";

export interface TestTelemetry {
  spans(): readonly ReadableSpan[];
  logs(): readonly Record<string, unknown>[];
  metrics(): Promise<readonly MetricData[]>;
  reset(): void;
  shutdown(): Promise<void>;
}

export interface TestTelemetryOptions {
  readonly logLevel?: LogLevel;
}

function parsedLines(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): Record<string, unknown> => JSON.parse(line));
}

export function installTestTelemetry(options: TestTelemetryOptions = {}): TestTelemetry {
  const spanExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  let written = "";
  const logDestination = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });

  const handle = startPipeline({
    serviceName: "qp-test",
    logLevel: options.logLevel ?? "debug",
    prettyLogs: false,
    logDestination,
    traceExporter: spanExporter,
    metricExporter,
    synchronousExport: true,
    autoInstrumentation: false,
  });

  return {
    spans: () => spanExporter.getFinishedSpans(),
    logs: () => parsedLines(written),
    metrics: async () => {
      await handle.flush();
      const latest = metricExporter.getMetrics().at(-1);
      return latest?.scopeMetrics.flatMap((scope) => scope.metrics) ?? [];
    },
    reset: () => {
      spanExporter.reset();
      metricExporter.reset();
      written = "";
    },
    shutdown: () => handle.shutdown(),
  };
}
