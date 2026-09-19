import { metrics, type Counter, type Histogram } from "@opentelemetry/api";
import { totalDropped, type DropCounts, type ScrubbedAttributes } from "./scrub.js";
import {
  DROP_REASONS,
  INSTRUMENTATION_SCOPE,
  SCRUB_ATTRIBUTES,
  type DropReason,
  type IngestDropReason,
  type SignalKind,
} from "./vocabulary.js";

export const DROPPED_COUNTER = "telemetry.scrub.dropped";

const INGEST_DROPPED_COUNTER = "telemetry.ingest.dropped";

const SESSION_DURATION = "questionnaire.session.duration";

const SESSION_DURATION_BUCKETS_MS = [
  1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 43_200_000, 86_400_000,
];

const counters = new Map<string, Counter>();

let sessionDuration: Histogram | undefined;

export function resetInstruments(): void {
  counters.clear();
  sessionDuration = undefined;
}

function counter(name: string): Counter {
  const existing = counters.get(name);
  if (existing !== undefined) return existing;
  const created = metrics.getMeter(INSTRUMENTATION_SCOPE).createCounter(name);
  counters.set(name, created);
  return created;
}

function durationHistogram(): Histogram {
  sessionDuration ??= metrics.getMeter(INSTRUMENTATION_SCOPE).createHistogram(SESSION_DURATION, {
    unit: "ms",
    advice: { explicitBucketBoundaries: SESSION_DURATION_BUCKETS_MS },
  });
  return sessionDuration;
}

function addDropped(kind: SignalKind, reason: DropReason, amount: number): boolean {
  try {
    counter(DROPPED_COUNTER).add(amount, { [SCRUB_ATTRIBUTES.signal]: kind, [SCRUB_ATTRIBUTES.reason]: reason });
    return true;
  } catch {
    return false;
  }
}

export function incrementCounter(name: string, attributes: ScrubbedAttributes): void {
  try {
    counter(name).add(1, attributes);
  } catch {
    addDropped("metric", "internal", 1);
  }
}

export function recordSessionDuration(milliseconds: number): void {
  try {
    durationHistogram().record(milliseconds);
  } catch {
    addDropped("metric", "internal", 1);
  }
}

export function reportDropped(kind: SignalKind, dropped: DropCounts): void {
  if (totalDropped(dropped) === 0) return;
  for (const reason of DROP_REASONS) {
    if (dropped[reason] > 0) addDropped(kind, reason, dropped[reason]);
  }
}

export function reportIngestDropped(reason: IngestDropReason, count: number = 1): void {
  if (count <= 0) return;
  try {
    counter(INGEST_DROPPED_COUNTER).add(count, { [SCRUB_ATTRIBUTES.ingestReason]: reason });
  } catch {
    addDropped("metric", "internal", 1);
  }
}
