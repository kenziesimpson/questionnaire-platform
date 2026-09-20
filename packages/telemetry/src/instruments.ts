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

const PAGE_LOAD_DURATION = "browser.page.load.duration";

const SESSION_DURATION_BUCKETS_MS = [
  1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 43_200_000, 86_400_000,
];

const PAGE_LOAD_DURATION_BUCKETS_MS = [100, 250, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000];

const counters = new Map<string, Counter>();

const histograms = new Map<string, Histogram>();

export function resetInstruments(): void {
  counters.clear();
  histograms.clear();
}

function counter(name: string): Counter {
  const existing = counters.get(name);
  if (existing !== undefined) return existing;
  const created = metrics.getMeter(INSTRUMENTATION_SCOPE).createCounter(name);
  counters.set(name, created);
  return created;
}

function durationHistogram(name: string, buckets: readonly number[]): Histogram {
  const existing = histograms.get(name);
  if (existing !== undefined) return existing;
  const created = metrics.getMeter(INSTRUMENTATION_SCOPE).createHistogram(name, {
    unit: "ms",
    advice: { explicitBucketBoundaries: [...buckets] },
  });
  histograms.set(name, created);
  return created;
}

function recordDuration(name: string, buckets: readonly number[], milliseconds: number): void {
  try {
    durationHistogram(name, buckets).record(milliseconds);
  } catch {
    addDropped("metric", "internal", 1);
  }
}

function addDropped(kind: SignalKind, reason: DropReason, amount: number): boolean {
  try {
    counter(DROPPED_COUNTER).add(amount, { [SCRUB_ATTRIBUTES.signal]: kind, [SCRUB_ATTRIBUTES.reason]: reason });
    return true;
  } catch {
    return false;
  }
}

export function incrementCounter(name: string, attributes: ScrubbedAttributes, amount: number = 1): void {
  try {
    counter(name).add(amount, attributes);
  } catch {
    addDropped("metric", "internal", 1);
  }
}

export function recordSessionDuration(milliseconds: number): void {
  recordDuration(SESSION_DURATION, SESSION_DURATION_BUCKETS_MS, milliseconds);
}

export function recordPageLoadDuration(milliseconds: number): void {
  recordDuration(PAGE_LOAD_DURATION, PAGE_LOAD_DURATION_BUCKETS_MS, milliseconds);
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
