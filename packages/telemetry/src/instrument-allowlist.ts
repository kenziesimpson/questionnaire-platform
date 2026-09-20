export const PG_OPERATION_DURATION = "db.client.operation.duration";

export const EVENT_LOOP_METRIC = /^nodejs\.eventloop\.(?:delay\.(?:min|max|mean|stddev|p50|p90|p99)|utilization)$/;

const EXPORTED_INSTRUMENTS: ReadonlyMap<string, (instrumentName: string) => boolean> = new Map([
  ["@opentelemetry/instrumentation-pg", (name) => name === PG_OPERATION_DURATION],
  ["@opentelemetry/instrumentation-runtime-node", (name) => EVENT_LOOP_METRIC.test(name)],
]);

export function isExportedInstrument(scopeName: string, instrumentName: string): boolean {
  return EXPORTED_INSTRUMENTS.get(scopeName)?.(instrumentName) ?? true;
}
