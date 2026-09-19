import type { ExportResult } from "@opentelemetry/core";
import { DataPointType, type DataPoint, type MetricData, type PushMetricExporter, type ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { reportDropped } from "./instruments.js";
import { scrubAttributes, type ScrubbedAttributes } from "./scrub.js";
import type { SignalKind } from "./vocabulary.js";

function cleaned(attributes: unknown, kind: SignalKind): ScrubbedAttributes {
  const result = scrubAttributes(attributes, kind);
  reportDropped(kind, result.dropped);
  return result.attributes;
}

function scrubbedSpan(span: ReadableSpan): ReadableSpan {
  return {
    name: span.name,
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
