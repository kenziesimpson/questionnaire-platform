import type { DraftItemCode, ResponseType, SubmissionItemCode } from "@qp/shared";
import { FIELDS, isCount, type CountField, type FieldName, type Outcome, type TelemetryContext } from "./fields.js";
import { guarded } from "./guard.js";
import { incrementCounter, recordPageLoadDuration, recordSessionDuration, reportDropped } from "./instruments.js";
import { logDomainEvent, relayLog } from "./logger.js";
import { oneDropped, scrubContext, type ScrubbedAttributes } from "./scrub.js";
import { EVENTS_LOG_MODULE } from "./vocabulary.js";

type NumericPayloadField<P> = { [K in keyof P]-?: NonNullable<P[K]> extends number ? K : never }[keyof P];

interface EventDefinition<P> {
  readonly counter: string | null;
  readonly labels: readonly FieldName[];
  readonly countBy: CountField | undefined;
  readonly payload?: P;
}

interface EventOptions<P> {
  readonly labels?: readonly FieldName[];
  readonly countBy?: CountField & NumericPayloadField<P>;
}

function event<P>(counter: string, options: EventOptions<P> = {}): EventDefinition<P> {
  return { counter, labels: options.labels ?? [], countBy: options.countBy };
}

function logOnly<P>(): EventDefinition<P> {
  return { counter: null, labels: [], countBy: undefined };
}

const DOMAIN_EVENTS = {
  "questionnaire.created": event<{ questionnaireId: string }>("questionnaire.created"),
  "questionnaire.published": event<{ questionnaireId: string; questionnaireVersion: number }>("questionnaire.published"),
  "questionnaire.retired": event<{ questionnaireId: string }>("questionnaire.retired"),
  "questionnaire.publish_finished": event<{ questionnaireId: string; outcome: Outcome; findingCount?: number; omittedCount?: number }>(
    "questionnaire.publish.total",
    { labels: ["outcome"] },
  ),
  "questionnaire.publish_rejected": logOnly<{ questionnaireId: string; itemId: string; problemCode: DraftItemCode }>(),
  "questionnaire.publish_items_rejected": event<{ questionnaireId: string; problemCode: DraftItemCode; codeFindingCount: number }>(
    "questionnaire.publish.rejections",
    { labels: ["problemCode"], countBy: "codeFindingCount" },
  ),
  "questionnaire.draft_conflict": event<{ questionnaireId: string }>("questionnaire.draft.conflicts"),
  "reporting.responses_listed": event<{ questionnaireId: string }>("questionnaire.responses.listed"),
  "reporting.response_viewed": event<{ questionnaireId: string; sessionId: string }>("questionnaire.responses.viewed"),
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
  "session.answer_rejected": logOnly<{ sessionId: string; itemId: string | null; questionId: string | null; reason: SubmissionItemCode }>(),
  "session.answers_rejected": event<{ sessionId: string; reason: SubmissionItemCode; codeFindingCount: number }>(
    "questionnaire.answers.rejected",
    { labels: ["reason"], countBy: "codeFindingCount" },
  ),
  "session.item_skipped": event<{ sessionId: string; itemId: string; questionId: string }>("questionnaire.items.skipped"),
  "session.abandoned": event<{ sessionId: string; lastItemId: string | null }>("questionnaire.sessions.abandoned"),
  "page.loaded": logOnly<{ route: string; durationMs: number }>(),
  "session.completed": event<{ sessionId: string; durationMs: number; questionCount: number }>("questionnaire.sessions.completed"),
  "session.rejected_past_cutoff": event<{ sessionId: string; questionnaireId: string; questionnaireVersion: number }>(
    "questionnaire.sessions.rejected_past_cutoff",
  ),
  "session.submit_finished": event<{
    sessionId: string;
    questionnaireId: string | null;
    questionnaireVersion: number | null;
    outcome: Outcome;
    findingCount?: number;
    omittedCount?: number;
  }>("questionnaire.submissions", { labels: ["outcome"] }),
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

function amountOf(countBy: CountField | undefined, fields: Readonly<Record<string, unknown>>): number | undefined {
  if (countBy === undefined) return 1;
  const amount = fields[countBy];
  if (isCount(amount) && FIELDS[countBy].accepts(amount)) return amount;
  reportDropped("metric", oneDropped("internal"));
  return undefined;
}

function countDomainEvent(name: DomainEventName, fields: Readonly<Record<string, unknown>>): void {
  const { counter, countBy } = DOMAIN_EVENTS[name];
  if (counter !== null) {
    const amount = amountOf(countBy, fields);
    if (amount !== undefined) incrementCounter(counter, labelsOf(name, fields), amount);
  }
  const { durationMs } = fields;
  if (name === "session.completed" && FIELDS.durationMs.accepts(durationMs)) {
    recordSessionDuration(durationMs);
  }
  if (name === "page.loaded" && FIELDS.durationMs.accepts(durationMs) && durationMs >= 0) {
    recordPageLoadDuration(durationMs);
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
