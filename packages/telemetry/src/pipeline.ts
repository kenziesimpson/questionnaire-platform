import { register } from "node:module";
import { FastifyOtelInstrumentation } from "@fastify/otel";
import { context, metrics, propagation, trace } from "@opentelemetry/api";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader, type PushMetricExporter } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, NoopSpanProcessor, SimpleSpanProcessor, type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace";
import pino, { type DestinationStream } from "pino";
import pretty from "pino-pretty";
import { scrubbingMetricExporter, scrubbingSpanExporter } from "./exporters.js";
import { reportDropped, resetInstruments } from "./instruments.js";
import { configureLogging, resetLogging, type LogLevel, type LogSink } from "./logger.js";
import { scrubAttributes } from "./scrub.js";

const LOADER_HOOK = "@opentelemetry/instrumentation/hook.mjs";

const TEST_EXPORT_INTERVAL_MS = 3_600_000;

export interface PipelineOptions {
  readonly serviceName: string;
  readonly logLevel: LogLevel;
  readonly prettyLogs: boolean;
  readonly logDestination: DestinationStream | undefined;
  readonly traceExporter: SpanExporter | undefined;
  readonly metricExporter: PushMetricExporter | undefined;
  readonly synchronousExport: boolean;
  readonly autoInstrumentation: boolean;
  readonly loaderHook: boolean;
}

export interface TelemetryHandle {
  readonly exporting: { readonly traces: boolean; readonly metrics: boolean };
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

function pinoSink(options: PipelineOptions): LogSink {
  const output = options.prettyLogs ? pretty({ colorize: true }) : options.logDestination;
  const instance = pino(
    {
      level: "debug",
      base: null,
      timestamp: options.prettyLogs ? true : pino.stdTimeFunctions.isoTime,
      formatters: {
        ...(options.prettyLogs ? {} : { level: (label: string) => ({ level: label }) }),
        log: (object) => {
          const scrubbed = scrubAttributes(object, "log");
          reportDropped("log", scrubbed.dropped);
          return { ...scrubbed.attributes };
        },
      },
    },
    output,
  );
  return ({ level, message, attributes }) => {
    instance[level](attributes, message);
  };
}

function spanProcessorFor(exporter: SpanExporter | undefined, synchronous: boolean): SpanProcessor {
  if (exporter === undefined) return new NoopSpanProcessor();
  const scrubbing = scrubbingSpanExporter(exporter);
  return synchronous ? new SimpleSpanProcessor({ exporter: scrubbing }) : new BatchSpanProcessor({ exporter: scrubbing });
}

function disableGlobalRegistrations(): void {
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
}

export function startPipeline(options: PipelineOptions): TelemetryHandle {
  disableGlobalRegistrations();
  resetInstruments();
  configureLogging({ level: options.logLevel, sink: pinoSink(options) });

  if (options.loaderHook) {
    register(LOADER_HOOK, import.meta.url);
  }

  const traceProcessor = spanProcessorFor(options.traceExporter, options.synchronousExport);
  const metricReaders =
    options.metricExporter === undefined
      ? []
      : [
          new PeriodicExportingMetricReader({
            exporter: scrubbingMetricExporter(options.metricExporter),
            ...(options.synchronousExport ? { exportIntervalMillis: TEST_EXPORT_INTERVAL_MS } : {}),
          }),
        ];

  const instrumentations: Instrumentation[] = options.autoInstrumentation
    ? [new FastifyOtelInstrumentation({ registerOnInitialization: true }), new PgInstrumentation()]
    : [];

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": options.serviceName }),
    autoDetectResources: false,
    spanProcessors: [traceProcessor],
    metricReaders,
    logRecordProcessors: [],
    instrumentations,
  });
  sdk.start();

  return {
    exporting: { traces: options.traceExporter !== undefined, metrics: options.metricExporter !== undefined },
    flush: async () => {
      await Promise.all([traceProcessor.forceFlush(), ...metricReaders.map((reader) => reader.forceFlush())]);
    },
    shutdown: async () => {
      await sdk.shutdown();
      for (const instrumentation of instrumentations) instrumentation.disable();
      disableGlobalRegistrations();
      resetInstruments();
      resetLogging();
    },
  };
}
