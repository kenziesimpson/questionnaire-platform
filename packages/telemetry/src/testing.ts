import { Writable } from "node:stream";
import { InMemoryLogRecordExporter, type ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter, type MetricData } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace";
import type { LoadedDatabaseDriver } from "./database-instrumentation.js";
import { DROPPED_COUNTER } from "./instruments.js";
import type { LogLevel } from "./logger.js";
import { startPipeline } from "./pipeline.js";
import { SCRUB_ATTRIBUTES } from "./vocabulary.js";

export type { LoadedDatabaseDriver } from "./database-instrumentation.js";

export interface TestTelemetry {
  spans(): readonly ReadableSpan[];
  logs(): readonly Record<string, unknown>[];
  logRecords(): readonly ReadableLogRecord[];
  metrics(): Promise<readonly MetricData[]>;
  internalDrops(): Promise<number>;
  reset(): void;
  shutdown(): Promise<void>;
}

export interface TestTelemetryOptions {
  readonly logLevel?: LogLevel;
  readonly autoInstrumentation?: boolean;
  readonly loadedDatabaseDriver?: LoadedDatabaseDriver;
}

export function internalDropCount(flushed: readonly MetricData[]): number {
  let total = 0;
  for (const metric of flushed) {
    if (metric.descriptor.name !== DROPPED_COUNTER) continue;
    for (const point of metric.dataPoints) {
      if (point.attributes[SCRUB_ATTRIBUTES.reason] === "internal" && typeof point.value === "number") total += point.value;
    }
  }
  return total;
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
  const logExporter = new InMemoryLogRecordExporter();
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
    logExporter,
    synchronousExport: true,
    autoInstrumentation: options.autoInstrumentation ?? false,
    loaderHook: false,
    loadedDatabaseDriver: options.loadedDatabaseDriver,
  });

  const flushedMetrics = async (): Promise<readonly MetricData[]> => {
    await handle.flush();
    const latest = metricExporter.getMetrics().at(-1);
    return latest?.scopeMetrics.flatMap((scope) => scope.metrics) ?? [];
  };

  return {
    spans: () => spanExporter.getFinishedSpans(),
    logs: () => parsedLines(written),
    logRecords: () => logExporter.getFinishedLogRecords(),
    metrics: flushedMetrics,
    internalDrops: async () => internalDropCount(await flushedMetrics()),
    reset: () => {
      spanExporter.reset();
      metricExporter.reset();
      logExporter.reset();
      written = "";
    },
    shutdown: () => handle.shutdown(),
  };
}
