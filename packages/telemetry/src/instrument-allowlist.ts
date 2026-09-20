export const PG_OPERATION_DURATION = "db.client.operation.duration";

const EVENT_LOOP_DELAY_STATISTICS = ["min", "max", "mean", "stddev", "p50", "p90", "p99"] as const;

export const EVENT_LOOP_METRIC_NAMES: readonly string[] = [
  ...EVENT_LOOP_DELAY_STATISTICS.map((statistic) => `nodejs.eventloop.delay.${statistic}`),
  "nodejs.eventloop.utilization",
];

const EXPORTED_INSTRUMENTS: ReadonlyMap<string, (instrumentName: string) => boolean> = new Map([
  ["@opentelemetry/instrumentation-pg", (name) => name === PG_OPERATION_DURATION],
  ["@opentelemetry/instrumentation-runtime-node", (name) => EVENT_LOOP_METRIC_NAMES.includes(name)],
]);

export function isExportedInstrument(scopeName: string, instrumentName: string): boolean {
  return EXPORTED_INSTRUMENTS.get(scopeName)?.(instrumentName) ?? true;
}
