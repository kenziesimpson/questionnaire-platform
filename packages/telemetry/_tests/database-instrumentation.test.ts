import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { DATABASE_INSTRUMENTATION_CONFIG } from "../src/database-instrumentation.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";

const LEAK = "LEAK_DIABETES_8F3A";

interface Statement {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

function fakeDriver() {
  const sent: Statement[] = [];

  class FakeClient {
    readonly database = "qp_fake";
    readonly connectionParameters = { host: "db", port: 5432, database: "qp_fake" };

    query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }> {
      sent.push({ text, values });
      return Promise.resolve({ rows: [] });
    }

    connect(): Promise<void> {
      return Promise.resolve();
    }
  }

  class FakePoolBase extends EventEmitter {
    readonly options = { connectionString: "postgresql://qp:pool-password-1a2b@db:5432/qp_fake" };

    connect(): Promise<FakeClient> {
      return Promise.resolve(new FakeClient());
    }
  }

  class FakePool extends FakePoolBase {}

  return { driver: { Client: FakeClient, Pool: FakePool }, sent, FakeClient, FakePool, FakePoolBase };
}

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
});

describe("the database instrumentation's configuration", () => {
  it("keeps bound parameters off the span and puts the trace context in a SQL comment", () => {
    expect(DATABASE_INSTRUMENTATION_CONFIG).toEqual({ enhancedDatabaseReporting: false, addSqlCommenterCommentToQueries: true });
  });
});

describe("patching a driver that was loaded before the instrumentation started", () => {
  it("exports a query span with only the registered database attributes, and no parameter or statement text", async () => {
    const { driver, FakeClient } = fakeDriver();
    telemetry = installTestTelemetry({ autoInstrumentation: true, loadedDatabaseDriver: driver });

    await new FakeClient().query("SELECT $1::text", [LEAK]);

    const spans = telemetry.spans().filter((span) => span.name === "pg.query:SELECT");
    expect(spans.map((span) => span.attributes)).toEqual([
      { "db.system.name": "postgresql", "db.namespace": "qp_fake", "server.address": "db", "server.port": 5432 },
    ]);
    expect(JSON.stringify(telemetry.spans())).not.toContain(LEAK);
    expect(JSON.stringify(telemetry.spans())).not.toContain("$1");
    expect(await telemetry.internalDrops()).toBe(0);
  });

  it("appends the trace context of the statement's own span to the SQL and leaves its parameters alone", async () => {
    const { driver, sent, FakeClient } = fakeDriver();
    telemetry = installTestTelemetry({ autoInstrumentation: true, loadedDatabaseDriver: driver });

    await new FakeClient().query("SELECT $1::text", [LEAK]);

    const span = telemetry.spans().find((candidate) => candidate.name === "pg.query:SELECT");
    const { traceId, spanId } = span?.spanContext() ?? { traceId: "", spanId: "" };
    expect(sent).toEqual([{ text: `SELECT $1::text /*traceparent='00-${traceId}-${spanId}-01'*/`, values: [LEAK] }]);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("traces a connection taken from the pool under the pool connect span name", async () => {
    const { driver, FakePool } = fakeDriver();
    telemetry = installTestTelemetry({ autoInstrumentation: true, loadedDatabaseDriver: driver });

    await new FakePool().connect();

    expect(telemetry.spans().map((span) => span.name)).toContain("pg-pool.connect");
    expect(JSON.stringify(telemetry.spans())).not.toContain("pool-password-1a2b");
    expect(telemetry.spans().find((span) => span.name === "pg-pool.connect")?.attributes).toEqual({
      "db.system.name": "postgresql",
      "db.namespace": "qp_fake",
      "server.address": "db",
      "server.port": 5432,
    });
  });

  it("traces nothing when no driver is handed over, and restores the driver when the telemetry shuts down", async () => {
    const { driver, sent, FakeClient } = fakeDriver();
    const original = FakeClient.prototype.query;
    telemetry = installTestTelemetry({ autoInstrumentation: true });
    await new FakeClient().query("SELECT 1");
    expect(telemetry.spans().filter((span) => span.name.startsWith("pg."))).toEqual([]);
    await telemetry.shutdown();

    telemetry = installTestTelemetry({ autoInstrumentation: true, loadedDatabaseDriver: driver });
    expect(FakeClient.prototype.query).not.toBe(original);
    await telemetry.shutdown();
    telemetry = undefined;

    expect(FakeClient.prototype.query).toBe(original);
    expect(sent.map((statement) => statement.text)).toEqual(["SELECT 1"]);
  });

  it("patches again for each telemetry installation, so every leak flow sees the driver", async () => {
    const { driver, FakeClient } = fakeDriver();
    for (const attempt of [1, 2, 3]) {
      const installed = installTestTelemetry({ autoInstrumentation: true, loadedDatabaseDriver: driver });
      await new FakeClient().query("SELECT 1");
      expect(installed.spans().filter((span) => span.name === "pg.query:SELECT"), `installation ${attempt}`).toHaveLength(1);
      await installed.shutdown();
    }
  });
});
