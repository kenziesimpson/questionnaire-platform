import { describe, expect, it } from "vitest";
import { isAmbientMetric, isDatabaseMetric, isDatabaseSpan } from "../src/ambient-signals.js";
import { isExportedInstrument } from "../src/instrument-allowlist.js";

describe("the signals that exist because the process runs", () => {
  it.each(["db.pool.connections.total", "db.pool.connections.idle", "db.pool.connections.waiting", "nodejs.eventloop.delay.p99", "nodejs.eventloop.utilization"])(
    "count %s as ambient",
    (name) => {
      expect(isAmbientMetric(name)).toBe(true);
    },
  );

  it.each(["questionnaire.sessions.started", "telemetry.scrub.dropped", "db.client.operation.duration", "nodejs.eventloop.time"])(
    "do not count %s as ambient",
    (name) => {
      expect(isAmbientMetric(name)).toBe(false);
    },
  );
});

describe("the signals a database call produces", () => {
  it.each(["pg.query", "pg.query:SELECT", "pg.connect", "pg-pool.connect"])("count the span %s as a database span", (name) => {
    expect(isDatabaseSpan(name)).toBe(true);
  });

  it.each(["request", "handler - handler", "session.submit", "pgx.query", "unnamed"])("do not count the span %s as a database span", (name) => {
    expect(isDatabaseSpan(name)).toBe(false);
  });

  it("counts the operation duration, and nothing else, as a database metric", () => {
    expect(isDatabaseMetric("db.client.operation.duration")).toBe(true);
    expect(isDatabaseMetric("db.pool.connections.total")).toBe(false);
  });
});

describe("the metrics an instrumentation may export", () => {
  it("are decided by scope: the two known scopes are closed lists and every other scope passes", () => {
    expect(isExportedInstrument("@opentelemetry/instrumentation-pg", "db.client.operation.duration")).toBe(true);
    expect(isExportedInstrument("@opentelemetry/instrumentation-pg", "db.client.connection.count")).toBe(false);
    expect(isExportedInstrument("@opentelemetry/instrumentation-runtime-node", "nodejs.eventloop.delay.max")).toBe(true);
    expect(isExportedInstrument("@opentelemetry/instrumentation-runtime-node", "v8js.gc.duration")).toBe(false);
    expect(isExportedInstrument("qp.telemetry", "anything")).toBe(true);
  });
});
