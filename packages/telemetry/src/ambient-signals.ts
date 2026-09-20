import { EVENT_LOOP_METRIC, PG_OPERATION_DURATION } from "./instrument-allowlist.js";
import { isDatabaseSpanName } from "./pg-span-names.js";
import { POOL_METRICS } from "./pool-metrics.js";

const POOL_METRIC_NAMES: readonly string[] = Object.values(POOL_METRICS);

export function isAmbientMetric(name: string): boolean {
  return POOL_METRIC_NAMES.includes(name) || EVENT_LOOP_METRIC.test(name);
}

export function isDatabaseMetric(name: string): boolean {
  return name === PG_OPERATION_DURATION;
}

export function isDatabaseSpan(name: string): boolean {
  return isDatabaseSpanName(name);
}
