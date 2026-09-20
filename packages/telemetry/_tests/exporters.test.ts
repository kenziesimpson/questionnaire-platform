import { ExportResultCode } from "@opentelemetry/core";
import type { Attributes } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ValueType } from "@opentelemetry/api";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  type MetricData,
  type ScopeMetrics,
} from "@opentelemetry/sdk-metrics";
import { SeverityNumber, logs } from "@opentelemetry/api-logs";
import { InMemoryLogRecordExporter, type ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, withSpan } from "../src/index.js";
import { scrubbingLogExporter, scrubbingMetricExporter, scrubbingSpanExporter } from "../src/exporters.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { internalDropsIn, metricPointsIn } from "./faults.js";
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

function gauge(name: string, attributes: Attributes = {}): MetricData {
  return {
    descriptor: { name, description: "", unit: "", valueType: ValueType.DOUBLE },
    aggregationTemporality: AggregationTemporality.CUMULATIVE,
    dataPointType: DataPointType.GAUGE,
    dataPoints: [{ attributes, startTime: [0, 0], endTime: [0, 0], value: 1 }],
  };
}

function exportedNames(scopes: readonly { name: string; metrics: readonly string[] }[]): Record<string, string[]> {
  const delegate = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  scrubbingMetricExporter(delegate).export(
    {
      resource: resourceFromAttributes({}),
      scopeMetrics: scopes.map((scope) => ({ scope: { name: scope.name }, metrics: scope.metrics.map((name) => gauge(name)) })),
    },
    () => undefined,
  );
  const exported = delegate.getMetrics()[0]?.scopeMetrics ?? [];
  return Object.fromEntries(exported.map((scope) => [scope.scope.name, scope.metrics.map((metric) => metric.descriptor.name)]));
}

describe("the metrics an instrumentation is allowed to export", () => {
  it("keep the pg operation duration and drop the connection metrics, whose labels are not on the allowlist", () => {
    expect(
      exportedNames([
        {
          name: "@opentelemetry/instrumentation-pg",
          metrics: ["db.client.operation.duration", "db.client.connection.count", "db.client.connection.pending_requests"],
        },
      ]),
    ).toEqual({ "@opentelemetry/instrumentation-pg": ["db.client.operation.duration"] });
  });

  it("keep the event-loop delay and utilization and drop every other runtime metric", () => {
    const delay = ["min", "max", "mean", "stddev", "p50", "p90", "p99"].map((statistic) => `nodejs.eventloop.delay.${statistic}`);

    expect(
      exportedNames([
        {
          name: "@opentelemetry/instrumentation-runtime-node",
          metrics: [
            ...delay,
            "nodejs.eventloop.utilization",
            "nodejs.eventloop.time",
            "v8js.gc.duration",
            "v8js.memory.heap.used",
            "v8js.resource.active",
          ],
        },
      ]),
    ).toEqual({ "@opentelemetry/instrumentation-runtime-node": [...delay, "nodejs.eventloop.utilization"] });
  });

  it("leave the metrics of any other scope alone, and omit a scope that has none left", () => {
    expect(
      exportedNames([
        { name: "qp.telemetry", metrics: ["questionnaire.sessions.started", "db.pool.connections.waiting"] },
        { name: "third-party", metrics: ["db.client.connection.count"] },
        { name: "@opentelemetry/instrumentation-pg", metrics: ["db.client.connection.count"] },
      ]),
    ).toEqual({
      "qp.telemetry": ["questionnaire.sessions.started", "db.pool.connections.waiting"],
      "third-party": ["db.client.connection.count"],
    });
  });

  it("scrub the labels of a metric it does keep", () => {
    const delegate = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    scrubbingMetricExporter(delegate).export(
      {
        resource: resourceFromAttributes({}),
        scopeMetrics: [
          {
            scope: { name: "@opentelemetry/instrumentation-pg" },
            metrics: [gauge("db.client.operation.duration", { "db.operation.name": "SELECT", "db.namespace": "qp", "db.query.text": "SELECT 1", "error.type": "22P02" })],
          },
        ],
      },
      () => undefined,
    );

    const [point] = delegate.getMetrics()[0]?.scopeMetrics[0]?.metrics[0]?.dataPoints ?? [];
    expect(point?.attributes).toEqual({ "db.operation.name": "SELECT", "db.namespace": "qp" });
  });
});

describe("the operation label of the pg duration metric", () => {
  function exportedOperation(operation: string): unknown {
    const delegate = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    scrubbingMetricExporter(delegate).export(
      {
        resource: resourceFromAttributes({}),
        scopeMetrics: [{ scope: { name: "@opentelemetry/instrumentation-pg" }, metrics: [gauge("db.client.operation.duration", { "db.operation.name": operation })] }],
      },
      () => undefined,
    );
    return delegate.getMetrics()[0]?.scopeMetrics[0]?.metrics[0]?.dataPoints[0]?.attributes["db.operation.name"];
  }

  it.each([
    ["SELECT", "SELECT"],
    ["TRUNCATE\n", "TRUNCATE"],
    ["CREATE", "CREATE"],
    ["SELECT\n1", "SELECT"],
    ["LEAK_DIABETES_8F3A", "OTHER"],
    ["leakdiabetes", "OTHER"],
    ["GRANT", "OTHER"],
    ["SELECTED", "OTHER"],
  ])("is normalised to a verb on the closed list, or OTHER: %j exports as %s", (operation, exported) => {
    expect(exportedOperation(operation)).toBe(exported);
  });
});

describe("the scrubbing log exporter", () => {
  function realRecord(): ReadableLogRecord {
    if (telemetry === undefined) {
      telemetry = installTestTelemetry();
      logger("execution").info("a real line", { sessionId: SESSION_ID });
    }
    const [record] = telemetry.logRecords();
    if (record === undefined) throw new Error("the real log record is missing");
    return record;
  }

  function installed(): TestTelemetry {
    if (telemetry === undefined) throw new Error("telemetry is not installed");
    return telemetry;
  }

  function exported(record: ReadableLogRecord): ReadableLogRecord {
    const delegate = new InMemoryLogRecordExporter();
    scrubbingLogExporter(delegate).export([record], () => undefined);
    const [scrubbed] = delegate.getFinishedLogRecords();
    if (scrubbed === undefined) throw new Error("nothing was exported");
    return scrubbed;
  }

  async function dropsFor(reason: string): Promise<boolean> {
    const dropped = await metricPointsIn(installed(), "telemetry.scrub.dropped");
    return dropped.some((point) => point.attributes["telemetry.signal"] === "log" && point.attributes["telemetry.reason"] === reason);
  }

  it("keeps a registered attribute and drops every other one, counting the drop", async () => {
    const record = { ...realRecord(), attributes: { "questionnaire.session_id": SESSION_ID, answer: "diabetes", "url.path": "/sessions/x", "http.request.body": "diabetes" } };

    expect(exported(record).attributes).toEqual({ "questionnaire.session_id": SESSION_ID });
    expect(await dropsFor("unknown")).toBe(true);
  });

  it("drops a registered attribute whose value fails its shape", () => {
    const record = { ...realRecord(), attributes: { "questionnaire.session_id": "diabetes" } };

    expect(exported(record).attributes).toEqual({});
  });

  it.each(["a real line", "session.started", "Migration failed:", `A${"x".repeat(127)}`])("keeps the literal-shaped body %j", (body) => {
    expect(exported({ ...realRecord(), body }).body).toBe(body);
  });

  it.each(["answer=diabetes", "it's an answer", "line\nbreak", "9 starts with a number", "", "a".repeat(129), '{"answer":1}'])(
    "replaces the body %j with unnamed and counts it invalid",
    async (body) => {
      const record = { ...realRecord(), body };

      expect(exported(record).body).toBe("unnamed");
      expect(await dropsFor("invalid")).toBe(true);
    },
  );

  it.each([{ answer: "diabetes" }, ["diabetes"], 7, undefined])("replaces a body that is not a string (%j) with unnamed", (body) => {
    expect(exported({ ...realRecord(), body }).body).toBe("unnamed");
  });

  it("keeps a severity text of the closed list and drops any other", () => {
    expect(exported({ ...realRecord(), severityText: "ERROR" }).severityText).toBe("ERROR");
    expect(exported({ ...realRecord(), severityText: "ERROR diabetes" }).severityText).toBeUndefined();
  });

  it("scrubs the attributes of the instrumentation scope, keeps its name and version, and reuses one scope object per source", async () => {
    const record = realRecord();
    const scope = { name: "third-party", version: "1.0.0", attributes: { answer: "diabetes", "url.path": "/sessions/x", "questionnaire.session_id": SESSION_ID } };
    const delegate = new InMemoryLogRecordExporter();

    scrubbingLogExporter(delegate).export([{ ...record, instrumentationScope: scope }, { ...record, instrumentationScope: scope }], () => undefined);

    const [first, second] = delegate.getFinishedLogRecords();
    expect(first?.instrumentationScope).toEqual({ name: "third-party", version: "1.0.0", schemaUrl: undefined, attributes: { "questionnaire.session_id": SESSION_ID } });
    expect(second?.instrumentationScope).toBe(first?.instrumentationScope);
    expect(await dropsFor("unknown")).toBe(true);
  });

  it("exports a record emitted with an event name without it", () => {
    realRecord();

    logs.getLogger("third-party").emit({ eventName: "answer.given", body: "a line" });

    const exportedRecord = installed().logRecords().find((candidate) => candidate.body === "a line");
    expect(exportedRecord).toBeDefined();
    expect(exportedRecord?.eventName).toBeUndefined();
  });

  it.each([
    [SeverityNumber.DEBUG, SeverityNumber.DEBUG],
    [SeverityNumber.INFO, SeverityNumber.INFO],
    [SeverityNumber.WARN, SeverityNumber.WARN],
    [SeverityNumber.ERROR, SeverityNumber.ERROR],
    [SeverityNumber.TRACE, undefined],
    [SeverityNumber.FATAL, undefined],
    [SeverityNumber.INFO2, undefined],
    [999, undefined],
    [undefined, undefined],
  ])("exports the severity number %j as %j", (severityNumber, expected) => {
    expect(exported({ ...realRecord(), severityNumber }).severityNumber).toBe(expected);
  });

  it("keeps the trace context and the severity number", () => {
    const record = realRecord();

    const scrubbed = exported(record);

    expect(scrubbed.severityNumber).toBe(record.severityNumber);
    expect(scrubbed.spanContext).toEqual(record.spanContext);
  });

  it("fails the batch, exports nothing and counts one internal log drop when a record's attributes cannot be read", async () => {
    const real = realRecord();
    const hostile = {
      ...real,
      get attributes(): ReadableLogRecord["attributes"] {
        throw new Error("hostile attributes");
      },
    };
    const delegate = new InMemoryLogRecordExporter();
    const callback = vi.fn();

    expect(() => {
      scrubbingLogExporter(delegate).export([hostile], callback);
    }).not.toThrow();

    expect(callback).toHaveBeenCalledExactlyOnceWith({ code: ExportResultCode.FAILED });
    expect(delegate.getFinishedLogRecords()).toEqual([]);
    expect(await internalDropsIn(installed())).toEqual({ log: 1 });
  });
});
