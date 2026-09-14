import { and, eq, exists, type SQL } from "drizzle-orm";
import type { Executor, Transaction } from "../client.js";
import { questionnaire, questionnaireVersion } from "../schema.js";

export interface LockedQuestionnaire {
  readonly id: string;
  readonly closesAt: Date | null;
}

export interface QuestionnaireNotFound {
  readonly outcome: "questionnaire-not-found";
}

async function lockQuestionnaire(tx: Transaction, questionnaireId: string): Promise<LockedQuestionnaire | undefined> {
  const [locked] = await tx
    .select({ id: questionnaire.id, closesAt: questionnaire.closesAt })
    .from(questionnaire)
    .where(eq(questionnaire.id, questionnaireId))
    .for("update");
  return locked;
}

export async function withLockedQuestionnaire<Outcome>(
  executor: Executor,
  questionnaireId: string,
  work: (tx: Transaction, locked: LockedQuestionnaire) => Promise<Outcome>,
): Promise<Outcome | QuestionnaireNotFound> {
  return executor.transaction(async (tx): Promise<Outcome | QuestionnaireNotFound> => {
    const locked = await lockQuestionnaire(tx, questionnaireId);
    if (locked === undefined) {
      return { outcome: "questionnaire-not-found" };
    }
    return work(tx, locked);
  });
}

export async function questionnaireExists(executor: Executor, questionnaireId: string): Promise<boolean> {
  const rows = await executor
    .select({ id: questionnaire.id })
    .from(questionnaire)
    .where(eq(questionnaire.id, questionnaireId));
  return rows.length === 1;
}

export function isOpenDraftOf(questionnaireId: string | typeof questionnaire.id) {
  return and(eq(questionnaireVersion.questionnaireId, questionnaireId), eq(questionnaireVersion.status, "draft"));
}

export function isPublishedVersion(): SQL {
  return eq(questionnaireVersion.status, "published");
}

export function isPublishedVersionOf(questionnaireId: string, version?: number): SQL | undefined {
  return and(
    eq(questionnaireVersion.questionnaireId, questionnaireId),
    isPublishedVersion(),
    version === undefined ? undefined : eq(questionnaireVersion.version, version),
  );
}

export function publishedValue<Value>(value: Value | null, column: string): Value {
  if (value === null) {
    throw new Error(`a published questionnaire version is missing its ${column}`);
  }
  return value;
}

export interface OpenDraftRow {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: Date;
  readonly draftRevision: number;
}

function selectOpenDraft(executor: Executor, questionnaireId: string) {
  return executor
    .select({
      id: questionnaireVersion.id,
      title: questionnaireVersion.title,
      updatedAt: questionnaireVersion.updatedAt,
      draftRevision: questionnaireVersion.draftRevision,
    })
    .from(questionnaireVersion)
    .where(isOpenDraftOf(questionnaireId));
}

export async function lockOpenDraft(tx: Transaction, questionnaireId: string): Promise<OpenDraftRow | undefined> {
  const [draft] = await selectOpenDraft(tx, questionnaireId).for("update");
  return draft;
}

export async function readOpenDraft(executor: Executor, questionnaireId: string): Promise<OpenDraftRow | undefined> {
  const [draft] = await selectOpenDraft(executor, questionnaireId);
  return draft;
}

export function openDraftExists(executor: Executor, questionnaireId: string | typeof questionnaire.id) {
  return exists(
    executor.select({ id: questionnaireVersion.id }).from(questionnaireVersion).where(isOpenDraftOf(questionnaireId)),
  ).mapWith(Boolean);
}
