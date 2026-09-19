import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { installTestTelemetry } from "./testing.js";
import type { SignalKind } from "./vocabulary.js";

export const LEAK_SENTINEL = "LEAK_DIABETES_8F3A";

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

export interface LeakExposure {
  readonly signal: SignalKind;
  readonly name: string;
}

export interface LeakFlow<World> {
  readonly name: string;
  run(world: World, sentinel: string): Promise<void>;
}

export interface LeakRunOptions {
  readonly sentinel?: string;
  readonly autoInstrumentation?: boolean;
}

export interface LeakRun {
  readonly exposures: readonly LeakExposure[];
  readonly observed: Readonly<Record<SignalKind, number>>;
  readonly spanNames: readonly string[];
}

function serialized(value: unknown): string {
  const seen = new WeakSet<object>();
  return String(
    JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return item.toString();
      if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
      if (item instanceof Map) return [...item];
      if (item instanceof Set) return [...item];
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

function exposed<T>(signal: SignalKind, items: readonly T[], nameOf: (item: T) => string, sentinel: string): LeakExposure[] {
  return items.filter((item) => carries(item, sentinel)).map((item) => ({ signal, name: nameOf(item) }));
}

function messageOf(line: Record<string, unknown>): string {
  return typeof line.msg === "string" ? line.msg : "log line";
}

export async function exposuresOf(telemetry: CapturedTelemetry, sentinel: string = LEAK_SENTINEL): Promise<LeakExposure[]> {
  return [
    ...exposed("log", telemetry.logs(), messageOf, sentinel),
    ...exposed("span", telemetry.spans(), (span) => span.name, sentinel),
    ...exposed("metric", await telemetry.metrics(), (metric) => metric.descriptor.name, sentinel),
  ];
}

export async function runLeakFlow<World>(
  flow: LeakFlow<World>,
  world: World,
  options: LeakRunOptions = {},
): Promise<LeakRun> {
  const sentinel = options.sentinel ?? LEAK_SENTINEL;
  const telemetry = installTestTelemetry({ autoInstrumentation: options.autoInstrumentation ?? false });
  try {
    await flow.run(world, sentinel);
    const flushed = await telemetry.metrics();
    return {
      exposures: await exposuresOf({ logs: telemetry.logs, spans: telemetry.spans, metrics: async () => flushed }, sentinel),
      observed: { log: telemetry.logs().length, span: telemetry.spans().length, metric: flushed.length },
      spanNames: telemetry.spans().map((span) => span.name),
    };
  } finally {
    await telemetry.shutdown();
  }
}

export function expectCleanRun(flowName: string, run: LeakRun, sentinel: string = LEAK_SENTINEL): void {
  if (run.exposures.length > 0) {
    const leaks = run.exposures.map((exposure) => `${exposure.signal}: ${exposure.name}`).join("; ");
    throw new Error(`TELEMETRY LEAK TEST FAILED: "${flowName}" let the sentinel ${sentinel} reach telemetry (${leaks})`);
  }
  if (run.observed.log + run.observed.span + run.observed.metric === 0) {
    throw new Error(`TELEMETRY LEAK TEST VACUOUS: "${flowName}" emitted no telemetry, so it proves nothing`);
  }
}

export function plantThirdPartyTelemetry(sentinel: string): void {
  const span = trace.getTracer("third-party").startSpan("GET", {
    attributes: {
      "url.path": `/api/run/sessions/s-1?answer=${sentinel}`,
      "url.full": `http://localhost/api/run/sessions/s-1?answer=${sentinel}`,
      "http.request.body": sentinel,
      "db.statement": `SELECT '${sentinel}'`,
    },
  });
  span.recordException(new Error(`failed ${sentinel}`));
  span.setStatus({ code: SpanStatusCode.ERROR, message: `failed ${sentinel}` });
  span.end();
  trace.getTracer("third-party").startSpan(sentinel).end();
  for (const name of [
    `handler - ${sentinel}`,
    `handler - ${sentinel.toLowerCase()}`,
    `pg.query:${sentinel}`,
    `pg.query:SELECT ${sentinel}`,
    `pg.query:SELECT ${sentinel.toLowerCase()}`,
  ]) {
    trace.getTracer("third-party").startSpan(name).end();
  }
  metrics.getMeter("third-party").createCounter("third_party.requests").add(1, { answer: sentinel, "url.path": sentinel });
}

export function plantThirdPartyCounter(labels: Readonly<Record<string, string>>): void {
  metrics.getMeter("third-party").createCounter("third_party.labelled").add(1, labels);
}
