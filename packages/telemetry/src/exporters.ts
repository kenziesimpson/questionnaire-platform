import type { ExportResult } from "@opentelemetry/core";
import { DataPointType, type DataPoint, type MetricData, type PushMetricExporter, type ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
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

const INSTRUMENTED_SPAN_NAMES: readonly RegExp[] = [
  /^request$/,
  new RegExp(`^(?:${FASTIFY_SPAN_PREFIXES.join("|")}) - [a-z@][A-Za-z0-9_$.@/-]{0,63}$`),
  /^pg\.query(?::[A-Za-z_]{1,32}(?: [A-Za-z0-9_-]{1,63})?)?$/,
  /^pg\.connect$/,
  /^pg-pool\.connect$/,
];

function exportedNameOf(name: string): string {
  if (isSpanName(name) || INSTRUMENTED_SPAN_NAMES.some((shape) => shape.test(name))) return name;
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
      delegate.export(spans.map(scrubbedSpan), resultCallback);
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
    scopeMetrics: resourceMetrics.scopeMetrics.map((scope) => ({
      scope: scope.scope,
      metrics: scope.metrics.map(scrubbedMetric),
    })),
  };
}

export function scrubbingMetricExporter(delegate: PushMetricExporter): PushMetricExporter {
  return {
    export: (metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void) => {
      delegate.export(scrubbedMetrics(metrics), resultCallback);
    },
    forceFlush: () => delegate.forceFlush(),
    shutdown: () => delegate.shutdown(),
    selectAggregationTemporality: delegate.selectAggregationTemporality?.bind(delegate),
    selectAggregation: delegate.selectAggregation?.bind(delegate),
  };
}
