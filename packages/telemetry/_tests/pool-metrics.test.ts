import { getPoolName } from "@opentelemetry/instrumentation-pg/build/src/utils.js";
import type { MetricData } from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it } from "vitest";
import { DATABASE_POOLS, watchPool } from "../src/index.js";
import { installTestTelemetry, internalDropCount, type TestTelemetry } from "../src/testing.js";
import { installFaultyMeter, internalDropsOf, restoreFaults } from "./faults.js";

let telemetry: TestTelemetry | undefined;
let stops: (() => void)[] = [];

afterEach(async () => {
  for (const stop of stops) stop();
  stops = [];
  await telemetry?.shutdown();
  telemetry = undefined;
});

function readingsIn(all: readonly MetricData[], name: string): Record<string, unknown> {
  const points = all.find((metric) => metric.descriptor.name === name)?.dataPoints ?? [];
  return Object.fromEntries(points.map((point) => [String(point.attributes["db.pool"]), point.value]));
}

describe("the pool gauges", () => {
  it("report total, idle and waiting connections for each watched pool, labelled by the bounded pool field", async () => {
    stops.push(
      watchPool("definition", () => ({ total: 3, idle: 2, waiting: 0 })),
      watchPool("execution", () => ({ total: 5, idle: 0, waiting: 4 })),
    );
    telemetry = installTestTelemetry();

    const all = await telemetry.metrics();

    expect(readingsIn(all, "db.pool.connections.total")).toEqual({ definition: 3, execution: 5 });
    expect(readingsIn(all, "db.pool.connections.idle")).toEqual({ definition: 2, execution: 0 });
    expect(readingsIn(all, "db.pool.connections.waiting")).toEqual({ definition: 0, execution: 4 });
  });

  it("read the pool when the metrics are collected, not when it was registered", async () => {
    let waiting = 0;
    stops.push(watchPool("reporting", () => ({ total: 1, idle: 0, waiting })));
    telemetry = installTestTelemetry();
    expect(readingsIn(await telemetry.metrics(), "db.pool.connections.waiting")).toEqual({ reporting: 0 });

    waiting = 7;

    expect(readingsIn(await telemetry.metrics(), "db.pool.connections.waiting")).toEqual({ reporting: 7 });
  });

  it("report a pool opened after the telemetry started, and not one that was closed before it", async () => {
    watchPool("definition", () => ({ total: 4, idle: 4, waiting: 0 }))();
    telemetry = installTestTelemetry();
    stops.push(watchPool("reporting", () => ({ total: 2, idle: 2, waiting: 0 })));

    expect(readingsIn(await telemetry.metrics(), "db.pool.connections.total")).toEqual({ reporting: 2 });
  });

  it("keep a newer pool of the same name when an older one stops", async () => {
    const older = watchPool("reporting", () => ({ total: 1, idle: 1, waiting: 0 }));
    stops.push(watchPool("reporting", () => ({ total: 9, idle: 9, waiting: 0 })));
    telemetry = installTestTelemetry();

    older();

    expect(readingsIn(await telemetry.metrics(), "db.pool.connections.total")).toEqual({ reporting: 9 });
  });

  it("skip a pool whose counts cannot be read, count an internal drop and still report the others", async () => {
    stops.push(
      watchPool("definition", () => {
        throw new Error("pool is gone");
      }),
      watchPool("execution", () => ({ total: 1, idle: 1, waiting: 0 })),
    );
    telemetry = installTestTelemetry();

    const all = await telemetry.metrics();

    expect(readingsIn(all, "db.pool.connections.total")).toEqual({ execution: 1 });
    expect(internalDropCount(all)).toBeGreaterThan(0);
  });
});

describe("starting the pool gauges", () => {
  afterEach(restoreFaults);

  it("never throws into startup when the meter cannot create a gauge, and counts one internal metric drop", () => {
    const recorded = installFaultyMeter({ failingGauges: true });

    expect(() => {
      telemetry = installTestTelemetry();
    }).not.toThrow();

    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });
});

type PoolOptions = Parameters<typeof getPoolName>[0];

function poolOptions(overrides: Partial<PoolOptions>): PoolOptions {
  return {
    allowExitOnIdle: false,
    database: "",
    host: "",
    idleTimeoutMillis: 10_000,
    max: 10,
    maxClient: 10,
    maxLifetimeSeconds: 0,
    maxUses: Number.POSITIVE_INFINITY,
    namespace: "",
    port: 0,
    user: "",
    ...overrides,
  };
}

describe("why the gauges exist beside the pg instrumentation's own pool metrics", () => {
  it("names a pool by host, port and database alone, so pools that differ only by role share one name", () => {
    const names = DATABASE_POOLS.map((pool) => getPoolName(poolOptions({ host: "db", port: 5432, database: "qp", user: `qp_${pool}` })));

    expect(names).toEqual(["db:5432/qp", "db:5432/qp", "db:5432/qp"]);
  });

  it("names a pool built from a connection string unknown_host:unknown_port/unknown_database, because the pool's options never parse the string", () => {
    const names = DATABASE_POOLS.map((pool) => getPoolName(poolOptions({ connectionString: `postgres://qp_${pool}:secret@db:5432/qp` })));

    expect(new Set(names)).toEqual(new Set(["unknown_host:unknown_port/unknown_database"]));
  });
});
