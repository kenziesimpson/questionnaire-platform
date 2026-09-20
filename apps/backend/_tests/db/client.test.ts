import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { POOL_ROLES } from "../../src/config.js";
import { useTestDatabase } from "./fixtures.js";

const testDatabase = useTestDatabase();

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
});

describe("openDatabase: each of the backend's three pools names itself to Postgres", () => {
  it.each(POOL_ROLES)("the %s pool connects with application_name qp-backend:%s", async (role) => {
    const result = await testDatabase.pool(role).query<{ name: string }>("SELECT current_setting('application_name') AS name");

    expect(result.rows[0]?.name).toBe(`qp-backend:${role}`);
  });

  it("leaves a connection that is not one of the three pools unnamed", async () => {
    const result = await testDatabase.pool("owner").query<{ name: string }>("SELECT current_setting('application_name') AS name");

    expect(result.rows[0]?.name).toBe("");
  });
});

describe("openDatabase: the pool gauges", () => {
  it("report each pool's connections under its own name", async () => {
    await testDatabase.pool("execution").query("SELECT 1");
    await testDatabase.pool("reporting").query("SELECT 1");
    telemetry = installTestTelemetry();

    const all = await telemetry.metrics();

    const totals = all.find((metric) => metric.descriptor.name === "db.pool.connections.total")?.dataPoints ?? [];
    const readings = totals.map((point) => ({ pool: point.attributes["db.pool"], value: point.value }));
    expect(readings).toContainEqual({ pool: "execution", value: 1 });
    expect(readings).toContainEqual({ pool: "reporting", value: 1 });
    const waiting = all.find((metric) => metric.descriptor.name === "db.pool.connections.waiting")?.dataPoints ?? [];
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((point) => point.value === 0)).toBe(true);
  });
});

describe("openDatabase: the pg instrumentation on a pool", () => {
  it("puts the trace context of the statement's own span in a comment, which Postgres shows in pg_stat_activity", async () => {
    telemetry = installTestTelemetry({ autoInstrumentation: true, loadedDatabaseDriver: pg });

    const result = await testDatabase.pool("execution").query<{ query: string }>("SELECT query FROM pg_stat_activity WHERE pid = pg_backend_pid()");

    const span = telemetry.spans().find((candidate) => candidate.name === "pg.query:SELECT");
    expect(span, "the statement must have produced a query span").toBeDefined();
    const { traceId, spanId } = span?.spanContext() ?? { traceId: "", spanId: "" };
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.rows[0]?.query).toContain(`/*traceparent='00-${traceId}-${spanId}-01'*/`);
  });

  it("exports the statement's span without its text or its parameters", async () => {
    telemetry = installTestTelemetry({ autoInstrumentation: true, loadedDatabaseDriver: pg });

    await testDatabase.pool("execution").query("SELECT $1::text AS planted", ["a bound parameter"]);

    const span = telemetry.spans().find((candidate) => candidate.name === "pg.query:SELECT");
    expect(span?.attributes).not.toHaveProperty("db.query.text");
    expect(span?.attributes["db.namespace"]).toMatch(/^qp_test_/);
    expect(JSON.stringify(telemetry.spans())).not.toContain("a bound parameter");
    expect(JSON.stringify(telemetry.spans())).not.toContain("planted");
  });
});
