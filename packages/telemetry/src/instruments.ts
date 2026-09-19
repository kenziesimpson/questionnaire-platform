import { metrics, type Counter, type Histogram } from "@opentelemetry/api";
import type { DomainEvent } from "./events.js";
import { scrubContext, totalDropped, type DropCounts, type ScrubbedAttributes } from "./scrub.js";
import { DROP_REASONS, INSTRUMENTATION_SCOPE, SCRUB_ATTRIBUTES, type SignalKind } from "./vocabulary.js";

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
  const created = metrics.getMeter(INSTRUMENTATION_SCOPE).createCounter(name);
  counters.set(name, created);
  return created;
}

function durationHistogram(): Histogram {
  sessionDuration ??= metrics.getMeter(INSTRUMENTATION_SCOPE).createHistogram(SESSION_DURATION, { unit: "ms" });
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
  for (const reason of DROP_REASONS) {
    if (dropped[reason] > 0) {
      counter(DROPPED_COUNTER).add(dropped[reason], { [SCRUB_ATTRIBUTES.signal]: kind, [SCRUB_ATTRIBUTES.reason]: reason });
    }
  }
}
