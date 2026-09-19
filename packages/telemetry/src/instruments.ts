import { metrics, type Counter, type Histogram } from "@opentelemetry/api";
import { totalDropped, type DropCounts, type ScrubbedAttributes } from "./scrub.js";
import { DROP_REASONS, INSTRUMENTATION_SCOPE, SCRUB_ATTRIBUTES, type SignalKind } from "./vocabulary.js";

const DROPPED_COUNTER = "telemetry.scrub.dropped";

const SESSION_DURATION = "questionnaire.session.duration";

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
  sessionDuration ??= metrics.getMeter(INSTRUMENTATION_SCOPE).createHistogram(SESSION_DURATION, { unit: "ms" });
  return sessionDuration;
}

export function incrementCounter(name: string, attributes: ScrubbedAttributes): void {
  counter(name).add(1, attributes);
}

export function recordSessionDuration(milliseconds: number): void {
  durationHistogram().record(milliseconds);
}

export function reportDropped(kind: SignalKind, dropped: DropCounts): void {
  if (totalDropped(dropped) === 0) return;
  for (const reason of DROP_REASONS) {
    if (dropped[reason] > 0) {
      counter(DROPPED_COUNTER).add(dropped[reason], { [SCRUB_ATTRIBUTES.signal]: kind, [SCRUB_ATTRIBUTES.reason]: reason });
    }
  }
}
