import { installTestTelemetry } from "./testing.js";
import type { SignalKind } from "./vocabulary.js";

export const CANARY_SENTINEL = "CANARY_DIABETES_8F3A";

interface Named {
  readonly name: string;
}

interface NamedMetric {
  readonly descriptor: Named;
}

export interface CapturedTelemetry {
  logs(): readonly Record<string, unknown>[];
  spans(): readonly Named[];
  metrics(): Promise<readonly NamedMetric[]>;
}

export interface CanaryExposure {
  readonly signal: SignalKind;
  readonly name: string;
}

export interface CanaryFlow<World> {
  readonly name: string;
  run(world: World, sentinel: string): Promise<void>;
}

export interface CanaryRun {
  readonly exposures: readonly CanaryExposure[];
  readonly observed: Readonly<Record<SignalKind, number>>;
}

function serialized(value: unknown): string {
  const seen = new WeakSet<object>();
  return String(
    JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return item.toString();
      if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return undefined;
        seen.add(item);
      }
      return item;
    }),
  );
}

function carries(value: unknown, sentinel: string): boolean {
  return serialized(value).toLowerCase().includes(sentinel.toLowerCase());
}

function exposed<T>(signal: SignalKind, items: readonly T[], nameOf: (item: T) => string, sentinel: string): CanaryExposure[] {
  return items.filter((item) => carries(item, sentinel)).map((item) => ({ signal, name: nameOf(item) }));
}

function messageOf(line: Record<string, unknown>): string {
  return typeof line.msg === "string" ? line.msg : "log line";
}

export async function exposuresOf(telemetry: CapturedTelemetry, sentinel: string = CANARY_SENTINEL): Promise<CanaryExposure[]> {
  return [
    ...exposed("log", telemetry.logs(), messageOf, sentinel),
    ...exposed("span", telemetry.spans(), (span) => span.name, sentinel),
    ...exposed("metric", await telemetry.metrics(), (metric) => metric.descriptor.name, sentinel),
  ];
}

export async function runCanaryFlow<World>(
  flow: CanaryFlow<World>,
  world: World,
  sentinel: string = CANARY_SENTINEL,
): Promise<CanaryRun> {
  const telemetry = installTestTelemetry();
  try {
    await flow.run(world, sentinel);
    const metrics = await telemetry.metrics();
    return {
      exposures: await exposuresOf({ logs: telemetry.logs, spans: telemetry.spans, metrics: async () => metrics }, sentinel),
      observed: { log: telemetry.logs().length, span: telemetry.spans().length, metric: metrics.length },
    };
  } finally {
    await telemetry.shutdown();
  }
}
