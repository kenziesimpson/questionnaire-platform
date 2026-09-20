export const POOL_METRICS = {
  total: "db.pool.connections.total",
  idle: "db.pool.connections.idle",
  waiting: "db.pool.connections.waiting",
} as const;

const EVENT_LOOP_METRIC = /^nodejs\.eventloop\.(?:delay\.(?:min|max|mean|stddev|p50|p90|p99)|utilization)$/;

const POOL_METRIC_NAMES: readonly string[] = Object.values(POOL_METRICS);

const EXPORTED_INSTRUMENTS: ReadonlyMap<string, RegExp> = new Map([
  ["@opentelemetry/instrumentation-pg", /^db\.client\.operation\.duration$/],
  ["@opentelemetry/instrumentation-runtime-node", EVENT_LOOP_METRIC],
]);

export function isExportedInstrument(scopeName: string, instrumentName: string): boolean {
  return EXPORTED_INSTRUMENTS.get(scopeName)?.test(instrumentName) ?? true;
}

export function isAmbientMetric(name: string): boolean {
  return POOL_METRIC_NAMES.includes(name) || EVENT_LOOP_METRIC.test(name);
}
