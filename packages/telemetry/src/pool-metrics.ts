import { metrics } from "@opentelemetry/api";
import { FIELDS, type FieldValue } from "./fields.js";
import { guarded } from "./guard.js";
import { INSTRUMENTATION_SCOPE } from "./vocabulary.js";

export const POOL_METRICS = {
  total: "db.pool.connections.total",
  idle: "db.pool.connections.idle",
  waiting: "db.pool.connections.waiting",
} as const;

export type PoolName = FieldValue<"pool">;

export interface PoolCounts {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
}

const CONNECTION_UNIT = "{connection}";

const watched = new Map<PoolName, () => PoolCounts>();

export function watchPool(pool: PoolName, counts: () => PoolCounts): () => void {
  watched.set(pool, counts);
  return () => {
    if (watched.get(pool) === counts) watched.delete(pool);
  };
}

export function startPoolGauges(): void {
  const meter = metrics.getMeter(INSTRUMENTATION_SCOPE);
  const total = meter.createObservableGauge(POOL_METRICS.total, {
    unit: CONNECTION_UNIT,
    description: "Connections a pool holds, idle or in use.",
  });
  const idle = meter.createObservableGauge(POOL_METRICS.idle, {
    unit: CONNECTION_UNIT,
    description: "Connections a pool holds that are not in use.",
  });
  const waiting = meter.createObservableGauge(POOL_METRICS.waiting, {
    unit: CONNECTION_UNIT,
    description: "Requests queued for a pool connection.",
  });
  meter.addBatchObservableCallback(
    (result) => {
      for (const [pool, counts] of watched) {
        guarded("metric", () => {
          const now = counts();
          const attributes = { [FIELDS.pool.attribute]: pool };
          result.observe(total, now.total, attributes);
          result.observe(idle, now.idle, attributes);
          result.observe(waiting, now.waiting, attributes);
        });
      }
    },
    [total, idle, waiting],
  );
}
