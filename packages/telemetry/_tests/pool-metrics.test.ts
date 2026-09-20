import type { MetricData } from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it } from "vitest";
import { watchPool } from "../src/index.js";
import { installTestTelemetry, internalDropCount, type TestTelemetry } from "../src/testing.js";

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
