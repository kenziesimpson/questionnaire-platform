import { and, eq, exists } from "drizzle-orm";
import type { Executor, Transaction } from "../client.js";
import { questionnaire, questionnaireVersion } from "../schema.js";

export interface LockedQuestionnaire {
  readonly id: string;
  readonly closesAt: Date | null;
}

export async function lockQuestionnaire(tx: Transaction, questionnaireId: string): Promise<LockedQuestionnaire | undefined> {
  const [locked] = await tx
    .select({ id: questionnaire.id, closesAt: questionnaire.closesAt })
    .from(questionnaire)
    .where(eq(questionnaire.id, questionnaireId))
    .for("update");
  return locked;
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

export interface OpenDraftRow {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: Date;
  readonly draftRevision: number;
}

export type OpenDraftLock = "for-update" | "unlocked";

export async function readOpenDraft(
  executor: Executor,
  questionnaireId: string,
  lock: OpenDraftLock,
): Promise<OpenDraftRow | undefined> {
  const query = executor
    .select({
      id: questionnaireVersion.id,
      title: questionnaireVersion.title,
      updatedAt: questionnaireVersion.updatedAt,
      draftRevision: questionnaireVersion.draftRevision,
    })
    .from(questionnaireVersion)
    .where(isOpenDraftOf(questionnaireId));
  const [draft] = await (lock === "for-update" ? query.for("update") : query);
  return draft;
}

export async function hasOpenDraft(executor: Executor, questionnaireId: string): Promise<boolean> {
  const drafts = await executor
    .select({ id: questionnaireVersion.id })
    .from(questionnaireVersion)
    .where(isOpenDraftOf(questionnaireId));
  return drafts.length > 0;
}

export function openDraftExists(executor: Executor, questionnaireId: string | typeof questionnaire.id) {
  return exists(
    executor.select({ id: questionnaireVersion.id }).from(questionnaireVersion).where(isOpenDraftOf(questionnaireId)),
  ).mapWith(Boolean);
}
