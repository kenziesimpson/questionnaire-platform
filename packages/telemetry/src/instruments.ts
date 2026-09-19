import { metrics, type Counter, type Histogram } from "@opentelemetry/api";
import type { DomainEvent } from "./events.js";
import { scrubContext, totalDropped, type DropCounts, type DropReason, type ScrubbedAttributes, type SignalKind } from "./scrub.js";

const METER_NAME = "qp.telemetry";

const EVENT_COUNTERS = {
  "questionnaire.created": "questionnaire.created",
  "questionnaire.published": "questionnaire.published",
  "questionnaire.retired": "questionnaire.retired",
  "session.started": "questionnaire.sessions.started",
  "session.resumed": "questionnaire.sessions.resumed",
  "session.question_answered": "questionnaire.answers.accepted",
  "session.answer_rejected": "questionnaire.answers.rejected",
  "session.item_skipped": "questionnaire.items.skipped",
  "session.abandoned": "questionnaire.sessions.abandoned",
  "session.completed": "questionnaire.sessions.completed",
} as const satisfies Record<DomainEvent["name"], string>;

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
  const created = metrics.getMeter(METER_NAME).createCounter(name);
  counters.set(name, created);
  return created;
}

function durationHistogram(): Histogram {
  sessionDuration ??= metrics.getMeter(METER_NAME).createHistogram(SESSION_DURATION, { unit: "ms" });
  return sessionDuration;
}

function boundedDimensionsOf(event: DomainEvent): ScrubbedAttributes {
  if (event.name === "session.question_answered") return scrubContext({ questionType: event.questionType }).attributes;
  if (event.name === "session.answer_rejected") return scrubContext({ reason: event.reason }).attributes;
  return {};
}

export function countDomainEvent(event: DomainEvent): void {
  counter(EVENT_COUNTERS[event.name]).add(1, boundedDimensionsOf(event));
  if (event.name === "session.completed") {
    durationHistogram().record(event.durationMs);
  }
}

export function reportDropped(kind: SignalKind, dropped: DropCounts): void {
  if (totalDropped(dropped) === 0) return;
  const reasons: readonly DropReason[] = ["unknown", "invalid", "unbounded"];
  for (const reason of reasons) {
    if (dropped[reason] > 0) {
      counter(DROPPED_COUNTER).add(dropped[reason], { "telemetry.signal": kind, "telemetry.reason": reason });
    }
  }
}
