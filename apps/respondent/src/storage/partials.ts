import { ClientAnswerValue, IsoDateTime, SLUG_PATTERN, Uuid, strict, type ClientAnswers } from "@qp/shared";
import Type, { type Static } from "typebox";
import { Value } from "typebox/value";

export const PARTIALS_FORMAT_VERSION = 1;

export const StoredPartialsEnvelope = Type.Object(
  {
    formatVersion: Type.Literal(PARTIALS_FORMAT_VERSION),
    sessionId: Uuid,
    questionnaireId: Uuid,
    answers: Type.Record(Type.String({ pattern: SLUG_PATTERN }), Type.Unknown(), strict),
    updatedAt: IsoDateTime,
  },
  strict,
);

const StoredAnswer = Type.Union([ClientAnswerValue, Type.Null()]);

export type StoredPartials = Omit<Static<typeof StoredPartialsEnvelope>, "answers"> & { readonly answers: ClientAnswers };

export interface PartialsSession {
  readonly sessionId: string;
  readonly questionnaireId: string;
}

export function partialsKey(questionnaireId: string): string {
  return `qp:respondent:${questionnaireId}`;
}

function withStorage<T>(operation: (storage: Storage) => T): T | undefined {
  try {
    return operation(globalThis.localStorage);
  } catch {
    return undefined;
  }
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isStoredAnswer(entry: [string, unknown]): entry is [string, ClientAnswerValue | null] {
  return Value.Check(StoredAnswer, entry[1]);
}

export function readPartials(questionnaireId: string): StoredPartials | undefined {
  const text = withStorage((storage) => storage.getItem(partialsKey(questionnaireId)));
  if (text === undefined || text === null) return undefined;
  const stored = parsedJson(text);
  if (!Value.Check(StoredPartialsEnvelope, stored) || stored.questionnaireId !== questionnaireId) return undefined;
  const answers: ClientAnswers = Object.fromEntries(Object.entries(stored.answers).filter(isStoredAnswer));
  return { ...stored, answers };
}

export function writePartials(session: PartialsSession, answers: ClientAnswers, now: Date = new Date()): void {
  const envelope: StoredPartials = {
    formatVersion: PARTIALS_FORMAT_VERSION,
    sessionId: session.sessionId,
    questionnaireId: session.questionnaireId,
    answers,
    updatedAt: now.toISOString(),
  };
  withStorage((storage) => storage.setItem(partialsKey(session.questionnaireId), JSON.stringify(envelope)));
}

export function clearPartialAnswers(session: PartialsSession, now: Date = new Date()): void {
  writePartials(session, {}, now);
}

export function removePartials(questionnaireId: string): void {
  withStorage((storage) => storage.removeItem(partialsKey(questionnaireId)));
}
