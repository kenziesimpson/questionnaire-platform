import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { DataPointType, type DataPoint, type MetricData, type PushMetricExporter, type ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { guardedOr } from "./guard.js";
import { isExportedInstrument } from "./instrument-allowlist.js";
import { PG_QUERY_SPAN_PREFIX, PG_SPANS_EXPORTED_AS_WRITTEN } from "./pg-span-names.js";
import { reportDropped } from "./instruments.js";
import { oneDropped, scrubAttributes, type ScrubbedAttributes } from "./scrub.js";
import { LOG_SEVERITIES } from "./log-records.js";
import { isSpanName } from "./spans.js";
import { LOG_MESSAGE_SHAPE, UNNAMED_LOG_MESSAGE, type SignalKind } from "./vocabulary.js";

const UNNAMED_SPAN = "unnamed";

const FASTIFY_SPAN_PREFIXES = [
  "onRequest",
  "preParsing",
  "preValidation",
  "preHandler",
  "preSerialization",
  "onSend",
  "onResponse",
  "onError",
  "handler",
  "notFoundHandler",
  "notFoundHandler - preValidation",
  "notFoundHandler - preHandler",
];

const FASTIFY_PLUGIN_NAME_FALLBACK = "fastify -> @fastify/otel";

const PG_COMMANDS = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "WITH",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "CREATE",
  "ALTER",
  "DROP",
  "SET",
  "RESET",
  "SHOW",
  "CALL",
  "EXPLAIN",
  "TRUNCATE",
  "LOCK",
  "COPY",
  "VALUES",
  "DO",
];

const EXPORTED_AS_WRITTEN: readonly RegExp[] = [
  /^request$/,
  new RegExp(`^(?:${FASTIFY_SPAN_PREFIXES.join("|")}) - (?:[a-z][A-Za-z0-9]{0,63}|${FASTIFY_PLUGIN_NAME_FALLBACK})$`),
];

const PG_VERB = new RegExp(`^(${PG_COMMANDS.join("|")})(?:\\s|$)`);

const OPERATION_LABEL = "db.operation.name";

const OTHER_OPERATION = "OTHER";

function pgVerbOf(text: string): string | undefined {
  return PG_VERB.exec(text)?.[1];
}

function operationLabelOf(value: unknown): unknown {
  return typeof value === "string" ? (pgVerbOf(value) ?? OTHER_OPERATION) : value;
}

function exportedNameOf(name: string): string {
  if (isSpanName(name) || PG_SPANS_EXPORTED_AS_WRITTEN.includes(name) || EXPORTED_AS_WRITTEN.some((shape) => shape.test(name))) return name;
  const verb = name.startsWith(PG_QUERY_SPAN_PREFIX) ? pgVerbOf(name.slice(PG_QUERY_SPAN_PREFIX.length)) : undefined;
  if (verb !== undefined) return `${PG_QUERY_SPAN_PREFIX}${verb}`;
  reportDropped("span", oneDropped("unknown"));
  return UNNAMED_SPAN;
}

function cleaned(attributes: unknown, kind: SignalKind): ScrubbedAttributes {
  const result = scrubAttributes(attributes, kind);
  reportDropped(kind, result.dropped);
  return result.attributes;
}

function scrubbedSpan(span: ReadableSpan): ReadableSpan {
  return {
    name: exportedNameOf(span.name),
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    status: { code: span.status.code },
    attributes: cleaned(span.attributes, "span"),
    links: span.links.map((link) => ({
      context: link.context,
      attributes: cleaned(link.attributes, "span"),
    })),
    events: span.events.map((event) => ({
      name: event.name,
      time: event.time,
      attributes: cleaned(event.attributes, "span"),
    })),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

export function scrubbingSpanExporter(delegate: SpanExporter): SpanExporter {
  return {
    export: (spans: ReadableSpan[], resultCallback: (result: ExportResult) => void) => {
      const scrubbed = guardedOr<ReadableSpan[] | undefined>("span", undefined, () => spans.map(scrubbedSpan));
      if (scrubbed === undefined) {
        resultCallback({ code: ExportResultCode.FAILED });
        return;
      }
      delegate.export(scrubbed, resultCallback);
    },
    shutdown: () => delegate.shutdown(),
    forceFlush: () => delegate.forceFlush?.() ?? Promise.resolve(),
  };
}

function scrubbedPoint<T>(point: DataPoint<T>): DataPoint<T> {
  const labels = Object.fromEntries(Object.entries(point.attributes).map(([key, value]) => [key, key === OPERATION_LABEL ? operationLabelOf(value) : value]));
  return { ...point, attributes: cleaned(labels, "metric") };
}

function scrubbedMetric(metric: MetricData): MetricData {
  switch (metric.dataPointType) {
    case DataPointType.SUM:
      return { ...metric, dataPoints: metric.dataPoints.map(scrubbedPoint) };
    case DataPointType.GAUGE:
      return { ...metric, dataPoints: metric.dataPoints.map(scrubbedPoint) };
    case DataPointType.HISTOGRAM:
      return { ...metric, dataPoints: metric.dataPoints.map(scrubbedPoint) };
    case DataPointType.EXPONENTIAL_HISTOGRAM:
      return { ...metric, dataPoints: metric.dataPoints.map(scrubbedPoint) };
  }
}

function scrubbedMetrics(resourceMetrics: ResourceMetrics): ResourceMetrics {
  return {
    resource: resourceMetrics.resource,
    scopeMetrics: resourceMetrics.scopeMetrics
      .map((scope) => ({
        scope: scope.scope,
        metrics: scope.metrics.filter((metric) => isExportedInstrument(scope.scope.name, metric.descriptor.name)).map(scrubbedMetric),
      }))
      .filter((scope) => scope.metrics.length > 0),
  };
}

export function scrubbingMetricExporter(delegate: PushMetricExporter): PushMetricExporter {
  return {
    export: (metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void) => {
      const scrubbed = guardedOr<ResourceMetrics | undefined>("metric", undefined, () => scrubbedMetrics(metrics));
      if (scrubbed === undefined) {
        resultCallback({ code: ExportResultCode.FAILED });
        return;
      }
      delegate.export(scrubbed, resultCallback);
    },
    forceFlush: () => delegate.forceFlush(),
    shutdown: () => delegate.shutdown(),
    selectAggregationTemporality: delegate.selectAggregationTemporality?.bind(delegate),
    selectAggregation: delegate.selectAggregation?.bind(delegate),
  };
}

const LOG_SEVERITY_TEXTS: readonly string[] = Object.values(LOG_SEVERITIES).map((severity) => severity.text);

const LOG_SEVERITY_NUMBERS: readonly number[] = Object.values(LOG_SEVERITIES).map((severity) => severity.number);

type LogScope = ReadableLogRecord["instrumentationScope"];

const scrubbedScopes = new WeakMap<object, LogScope>();

function exportedLogBody(body: ReadableLogRecord["body"]): string {
  if (typeof body === "string" && LOG_MESSAGE_SHAPE.test(body)) return body;
  reportDropped("log", oneDropped("invalid"));
  return UNNAMED_LOG_MESSAGE;
}

function exportedLogScope(scope: LogScope): LogScope {
  const known = scrubbedScopes.get(scope);
  if (known !== undefined) return known;
  const exported: LogScope = {
    name: scope.name,
    version: scope.version,
    schemaUrl: scope.schemaUrl,
    attributes: cleaned(scope.attributes, "log"),
  };
  scrubbedScopes.set(scope, exported);
  return exported;
}

function scrubbedLogRecord(record: ReadableLogRecord): ReadableLogRecord {
  const { severityText, severityNumber } = record;
  return {
    hrTime: record.hrTime,
    hrTimeObserved: record.hrTimeObserved,
    spanContext: record.spanContext,
    severityText: severityText !== undefined && LOG_SEVERITY_TEXTS.includes(severityText) ? severityText : undefined,
    severityNumber: severityNumber !== undefined && LOG_SEVERITY_NUMBERS.includes(severityNumber) ? severityNumber : undefined,
    body: exportedLogBody(record.body),
    resource: record.resource,
    instrumentationScope: exportedLogScope(record.instrumentationScope),
    attributes: cleaned(record.attributes, "log"),
    droppedAttributesCount: record.droppedAttributesCount,
  };
}

export function scrubbingLogExporter(delegate: LogRecordExporter): LogRecordExporter {
  return {
    export: (records: ReadableLogRecord[], resultCallback: (result: ExportResult) => void) => {
      const scrubbed = guardedOr<ReadableLogRecord[] | undefined>("log", undefined, () => records.map(scrubbedLogRecord));
      if (scrubbed === undefined) {
        resultCallback({ code: ExportResultCode.FAILED });
        return;
      }
      delegate.export(scrubbed, resultCallback);
    },
    shutdown: () => delegate.shutdown(),
    forceFlush: () => delegate.forceFlush(),
  };
}
