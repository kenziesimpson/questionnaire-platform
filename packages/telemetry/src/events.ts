import type { ResponseType, SubmissionItemCode } from "@qp/shared";
import { FIELDS, type FieldName, type Outcome, type TelemetryContext } from "./fields.js";
import { guarded } from "./guard.js";
import { incrementCounter, recordSessionDuration, reportDropped } from "./instruments.js";
import { logDomainEvent, relayLog } from "./logger.js";
import { scrubContext, type ScrubbedAttributes } from "./scrub.js";
import { EVENTS_LOG_MODULE } from "./vocabulary.js";

interface EventDefinition<P> {
  readonly counter: string;
  readonly labels: readonly FieldName[];
  readonly payload?: P;
}

interface EventOptions {
  readonly labels?: readonly FieldName[];
}

function event<P>(counter: string, options: EventOptions = {}): EventDefinition<P> {
  return { counter, labels: options.labels ?? [] };
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
    { labels: ["questionType"] },
  ),
  "session.answer_rejected": event<{ sessionId: string; itemId: string | null; questionId: string | null; reason: SubmissionItemCode }>(
    "questionnaire.answers.rejected",
    { labels: ["reason"] },
  ),
  "session.item_skipped": event<{ sessionId: string; itemId: string; questionId: string }>("questionnaire.items.skipped"),
  "session.abandoned": event<{ sessionId: string; lastItemId: string | null }>("questionnaire.sessions.abandoned"),
  "session.completed": event<{ sessionId: string; durationMs: number; questionCount: number }>("questionnaire.sessions.completed"),
  "session.rejected_past_cutoff": event<{ sessionId: string; questionnaireId: string; questionnaireVersion: number }>(
    "questionnaire.sessions.rejected_past_cutoff",
  ),
  "session.submit_finished": event<{
    sessionId: string;
    questionnaireId: string | null;
    questionnaireVersion: number | null;
    outcome: Outcome;
  }>(
    "questionnaire.submissions",
    { labels: ["outcome"] },
  ),
};

export type DomainEventName = keyof typeof DOMAIN_EVENTS;

type PayloadOf<N extends DomainEventName> = NonNullable<(typeof DOMAIN_EVENTS)[N]["payload"]>;

export type DomainEventField<N extends DomainEventName> = keyof PayloadOf<N>;

export type DomainEvent = { [N in DomainEventName]: { readonly name: N } & Readonly<PayloadOf<N>> }[DomainEventName];

function labelsOf(name: DomainEventName, fields: Readonly<Record<string, unknown>>): ScrubbedAttributes {
  const scrubbed = scrubContext(Object.fromEntries(DOMAIN_EVENTS[name].labels.map((label) => [label, fields[label]])));
  reportDropped("metric", scrubbed.dropped);
  return scrubbed.attributes;
}

function countDomainEvent(name: DomainEventName, fields: Readonly<Record<string, unknown>>): void {
  incrementCounter(DOMAIN_EVENTS[name].counter, labelsOf(name, fields));
  const { durationMs } = fields;
  if (name === "session.completed" && FIELDS.durationMs.accepts(durationMs)) {
    recordSessionDuration(durationMs);
  }
}

export function emitDomainEvent(event: DomainEvent): void {
  guarded("log", () => {
    const { name, ...fields } = event;
    const context: TelemetryContext = fields;
    logDomainEvent(name, context);
  });
  guarded("metric", () => {
    const { name, ...fields } = event;
    countDomainEvent(name, fields);
  });
}

export function relayBrowserEvent(name: DomainEventName, fields: Readonly<Record<string, unknown>>): boolean {
  const logged = relayLog("info", EVENTS_LOG_MODULE, name, fields);
  guarded("metric", () => {
    countDomainEvent(name, fields);
  });
  return logged;
}
