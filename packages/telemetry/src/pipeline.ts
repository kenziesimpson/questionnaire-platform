import { register } from "node:module";
import { FastifyOtelInstrumentation } from "@fastify/otel";
import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, SimpleLogRecordProcessor, type LogRecordExporter, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader, type PushMetricExporter } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, NoopSpanProcessor, SimpleSpanProcessor, type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace";
import pino, { type DestinationStream } from "pino";
import pretty from "pino-pretty";
import { ClientTraceSpanProcessor } from "./client-trace-processor.js";
import { DatabaseInstrumentation, type LoadedDatabaseDriver } from "./database-instrumentation.js";
import { scrubbingLogExporter, scrubbingMetricExporter, scrubbingSpanExporter } from "./exporters.js";
import { guarded } from "./guard.js";
import { reportDropped, resetInstruments } from "./instruments.js";
import { configureLogging, resetLogging, type LogLevel, type LogSink } from "./logger.js";
import { alsoEmittingLogRecords } from "./log-records.js";
import { startPoolGauges } from "./pool-metrics.js";
import { scrubAttributes } from "./scrub.js";
import { TraceparentOnlyPropagator } from "./trace-propagator.js";

const LOADER_HOOK = "@opentelemetry/instrumentation/hook.mjs";

const TEST_EXPORT_INTERVAL_MS = 3_600_000;

export interface PipelineOptions {
  readonly serviceName: string;
  readonly logLevel: LogLevel;
  readonly prettyLogs: boolean;
  readonly logDestination: DestinationStream | undefined;
  readonly traceExporter: SpanExporter | undefined;
  readonly metricExporter: PushMetricExporter | undefined;
  readonly logExporter: LogRecordExporter | undefined;
  readonly synchronousExport: boolean;
  readonly autoInstrumentation: boolean;
  readonly loaderHook: boolean;
  readonly loadedDatabaseDriver: LoadedDatabaseDriver | undefined;
}

export interface TelemetryHandle {
  readonly exporting: { readonly traces: boolean; readonly metrics: boolean; readonly logs: boolean };
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

function logProcessorFor(exporter: LogRecordExporter | undefined, synchronous: boolean): LogRecordProcessor | undefined {
  if (exporter === undefined) return undefined;
  const scrubbing = scrubbingLogExporter(exporter);
  return synchronous ? new SimpleLogRecordProcessor({ exporter: scrubbing }) : new BatchLogRecordProcessor({ exporter: scrubbing });
}

function disableGlobalRegistrations(): void {
  trace.disable();
  metrics.disable();
  logs.disable();
  context.disable();
  propagation.disable();
}

export function startPipeline(options: PipelineOptions): TelemetryHandle {
  disableGlobalRegistrations();
  resetInstruments();
  const logProcessor = logProcessorFor(options.logExporter, options.synchronousExport);
  configureLogging({ level: options.logLevel, sink: logProcessor === undefined ? pinoSink(options) : alsoEmittingLogRecords(pinoSink(options)) });

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

  const database = options.autoInstrumentation ? new DatabaseInstrumentation() : undefined;
  const instrumentations: Instrumentation[] =
    database === undefined
      ? []
      : [new FastifyOtelInstrumentation({ registerOnInitialization: true }), database, new RuntimeNodeInstrumentation()];

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": options.serviceName }),
    autoDetectResources: false,
    spanProcessors: [new ClientTraceSpanProcessor(), traceProcessor],
    metricReaders,
    textMapPropagator: new TraceparentOnlyPropagator(),
    logRecordProcessors: logProcessor === undefined ? [] : [logProcessor],
    instrumentations,
  });
  sdk.start();
  guarded("metric", startPoolGauges);
  if (options.loadedDatabaseDriver !== undefined) database?.patchLoaded(options.loadedDatabaseDriver);

  return {
    exporting: { traces: options.traceExporter !== undefined, metrics: options.metricExporter !== undefined, logs: logProcessor !== undefined },
    flush: async () => {
      await Promise.all([
        traceProcessor.forceFlush(),
        ...metricReaders.map((reader) => reader.forceFlush()),
        ...(logProcessor === undefined ? [] : [logProcessor.forceFlush()]),
      ]);
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
