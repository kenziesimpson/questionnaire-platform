import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { DataPointType, type DataPoint, type MetricData, type PushMetricExporter, type ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { isExportedInstrument } from "./ambient-metrics.js";
import { guardedOr } from "./guard.js";
import { reportDropped } from "./instruments.js";
import { oneDropped, scrubAttributes, type ScrubbedAttributes } from "./scrub.js";
import { isSpanName } from "./spans.js";
import type { SignalKind } from "./vocabulary.js";

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
  "SET",
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
  new RegExp(`^pg\\.query(?::(?:${PG_COMMANDS.join("|")}))?$`),
  /^pg\.connect$/,
  /^pg-pool\.connect$/,
];

const PG_QUERY_WITH_DATABASE = new RegExp(`^pg\\.query:(${PG_COMMANDS.join("|")}) \\S{1,63}$`);

function exportedNameOf(name: string): string {
  if (isSpanName(name) || EXPORTED_AS_WRITTEN.some((shape) => shape.test(name))) return name;
  const command = PG_QUERY_WITH_DATABASE.exec(name)?.[1];
  if (command !== undefined) return `pg.query:${command}`;
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
  return { ...point, attributes: cleaned(point.attributes, "metric") };
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
