import { createNoopMeter, metrics, type Attributes, type Counter, type Histogram } from "@opentelemetry/api";
import { vi } from "vitest";
import { DROPPED_COUNTER, resetInstruments } from "../src/instruments.js";
import type { TestTelemetry } from "../src/testing.js";

export { DROPPED_COUNTER } from "../src/instruments.js";

export interface RecordedMeasurement {
  readonly name: string;
  readonly value: number;
  readonly attributes: Attributes | undefined;
}

export interface MeterFaults {
  readonly failing?: readonly string[];
  readonly unavailable?: boolean;
}

export function installFaultyMeter(faults: MeterFaults = {}): RecordedMeasurement[] {
  const recorded: RecordedMeasurement[] = [];
  const failing = faults.failing ?? [];
  const meter = createNoopMeter();
  vi.spyOn(meter, "createCounter").mockImplementation(
    (name): Counter => ({
      add: (value, attributes) => {
        if (failing.includes(name)) throw new Error("counter failed");
        recorded.push({ name, value, attributes });
      },
    }),
  );
  vi.spyOn(meter, "createHistogram").mockImplementation(
    (name): Histogram => ({
      record: (value, attributes) => {
        if (failing.includes(name)) throw new Error("histogram failed");
        recorded.push({ name, value, attributes });
      },
    }),
  );
  vi.spyOn(metrics, "getMeter").mockImplementation(() => {
    if (faults.unavailable === true) throw new Error("meter unavailable");
    return meter;
  });
  resetInstruments();
  return recorded;
}

export function restoreFaults(): void {
  vi.restoreAllMocks();
  resetInstruments();
}

export function internalDropsOf(recorded: readonly RecordedMeasurement[]): string[] {
  return recorded
    .filter((entry) => entry.name === DROPPED_COUNTER && entry.attributes?.["telemetry.reason"] === "internal")
    .map((entry) => String(entry.attributes?.["telemetry.signal"]));
}

export async function internalDropsIn(installed: TestTelemetry): Promise<Record<string, number>> {
  const all = await installed.metrics();
  const dropped = all.find((metric) => metric.descriptor.name === DROPPED_COUNTER);
  const internal = (dropped?.dataPoints ?? []).filter((point) => point.attributes["telemetry.reason"] === "internal");
  return Object.fromEntries(internal.map((point) => [String(point.attributes["telemetry.signal"]), typeof point.value === "number" ? point.value : 0]));
}

export async function metricPointsIn(installed: TestTelemetry, name: string) {
  const all = await installed.metrics();
  return all.find((metric) => metric.descriptor.name === name)?.dataPoints ?? [];
}

export async function ingestDropsIn(installed: TestTelemetry): Promise<Record<string, unknown>> {
  const points = await metricPointsIn(installed, "telemetry.ingest.dropped");
  return Object.fromEntries(points.map((point) => [`${point.attributes["telemetry.ingest_reason"]}`, point.value]));
}

export async function counterValueIn(installed: TestTelemetry, name: string): Promise<number> {
  const points = await metricPointsIn(installed, name);
  return points.reduce((total, point) => total + (typeof point.value === "number" ? point.value : 0), 0);
}
