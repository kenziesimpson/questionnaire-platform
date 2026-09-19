import type { ResponseType, SubmissionItemCode } from "@qp/shared";
import type { TelemetryContext } from "./fields.js";
import { incrementCounter, recordSessionDuration } from "./instruments.js";
import { logger } from "./logger.js";
import { scrubContext, type ScrubbedAttributes } from "./scrub.js";

interface EventDefinition<P> {
  readonly counter: string;
  readonly payload?: P;
}

function event<P>(counter: string): EventDefinition<P> {
  return { counter };
}

const DOMAIN_EVENTS = {
  "questionnaire.created": event<{ questionnaireId: string }>("questionnaire.created"),
  "questionnaire.published": event<{ questionnaireId: string; questionnaireVersion: number }>("questionnaire.published"),
  "questionnaire.retired": event<{ questionnaireId: string }>("questionnaire.retired"),
  "session.started": event<{ sessionId: string; questionnaireId: string; questionnaireVersion: number }>(
    "questionnaire.sessions.started",
  ),
  "session.resumed": event<{ sessionId: string; questionnaireId: string; questionnaireVersion: number; elapsedSeconds: number }>(
    "questionnaire.sessions.resumed",
  ),
  "session.question_answered": event<{ sessionId: string; itemId: string; questionId: string; questionType: ResponseType }>(
    "questionnaire.answers.accepted",
  ),
  "session.answer_rejected": event<{ sessionId: string; itemId: string; questionId: string; reason: SubmissionItemCode }>(
    "questionnaire.answers.rejected",
  ),
  "session.item_skipped": event<{ sessionId: string; itemId: string; questionId: string }>("questionnaire.items.skipped"),
  "session.abandoned": event<{ sessionId: string; lastItemId: string | null }>("questionnaire.sessions.abandoned"),
  "session.completed": event<{ sessionId: string; durationMs: number; questionCount: number }>("questionnaire.sessions.completed"),
};

type DomainEventName = keyof typeof DOMAIN_EVENTS;

type PayloadOf<N extends DomainEventName> = NonNullable<(typeof DOMAIN_EVENTS)[N]["payload"]>;

export type DomainEvent = { [N in DomainEventName]: { readonly name: N } & Readonly<PayloadOf<N>> }[DomainEventName];

function boundedDimensionsOf(event: DomainEvent): ScrubbedAttributes {
  if (event.name === "session.question_answered") return scrubContext({ questionType: event.questionType }).attributes;
  if (event.name === "session.answer_rejected") return scrubContext({ reason: event.reason }).attributes;
  return {};
}

function countDomainEvent(event: DomainEvent): void {
  incrementCounter(DOMAIN_EVENTS[event.name].counter, boundedDimensionsOf(event));
  if (event.name === "session.completed") {
    recordSessionDuration(event.durationMs);
  }
}

const eventLog = logger("events");

export function emitDomainEvent(event: DomainEvent): void {
  const { name, ...fields } = event;
  const context: TelemetryContext = fields;
  eventLog.info(name, context);
  countDomainEvent(event);
}
