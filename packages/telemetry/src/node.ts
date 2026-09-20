import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { LogLevel } from "./logger.js";
import { startPipeline, type TelemetryHandle } from "./pipeline.js";

export type { TelemetryHandle } from "./pipeline.js";

export interface TelemetryOptions {
  readonly serviceName: string;
  readonly logLevel: LogLevel;
  readonly prettyLogs: boolean;
  readonly otlpEndpoint: string | undefined;
  readonly autoInstrumentation: boolean;
}

function signalUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}

let running: TelemetryHandle | undefined;

export function runningTelemetry(): TelemetryHandle | undefined {
  return running;
}

export function startTelemetry(options: TelemetryOptions): TelemetryHandle {
  const handle = startPipelineFor(options);
  const started: TelemetryHandle = {
    ...handle,
    shutdown: async () => {
      try {
        await handle.shutdown();
      } finally {
        if (running === started) running = undefined;
      }
    },
  };
  running = started;
  return started;
}

function startPipelineFor(options: TelemetryOptions): TelemetryHandle {
  const { otlpEndpoint } = options;
  const exporting = otlpEndpoint !== undefined && otlpEndpoint !== "";
  return startPipeline({
    serviceName: options.serviceName,
    logLevel: options.logLevel,
    prettyLogs: options.prettyLogs,
    logDestination: undefined,
    traceExporter: exporting ? new OTLPTraceExporter({ url: signalUrl(otlpEndpoint, "/v1/traces") }) : undefined,
    metricExporter: exporting ? new OTLPMetricExporter({ url: signalUrl(otlpEndpoint, "/v1/metrics") }) : undefined,
    logExporter: exporting ? new OTLPLogExporter({ url: signalUrl(otlpEndpoint, "/v1/logs") }) : undefined,
    synchronousExport: false,
    autoInstrumentation: options.autoInstrumentation,
    loaderHook: options.autoInstrumentation,
    loadedDatabaseDriver: undefined,
  });
}
