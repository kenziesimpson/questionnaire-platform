import type { QuestionnaireSummary } from "@qp/shared";
import { desc, eq, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit.js";
import type { Executor } from "../client.js";
import { questionnaire, questionnaireVersion } from "../schema.js";
import { openDraftExists, withLockedQuestionnaire, type QuestionnaireNotFound } from "./questionnaire-rows.js";

async function selectQuestionnaireSummaries(executor: Executor, filter?: SQL): Promise<QuestionnaireSummary[]> {
  const rows = await executor
    .select({
      questionnaireId: questionnaire.id,
      key: questionnaire.key,
      name: questionnaire.name,
      currentVersion: questionnaire.currentVersion,
      closesAt: questionnaire.closesAt,
      hasDraft: openDraftExists(executor, questionnaire.id),
      createdAt: questionnaire.createdAt,
    })
    .from(questionnaire)
    .where(filter)
    .orderBy(desc(questionnaire.id));

  return rows.map((row) => ({
    questionnaireId: row.questionnaireId,
    key: row.key,
    name: row.name,
    currentVersion: row.currentVersion,
    closesAt: row.closesAt?.toISOString() ?? null,
    hasDraft: row.hasDraft,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listQuestionnaireSummaries(executor: Executor): Promise<QuestionnaireSummary[]> {
  return selectQuestionnaireSummaries(executor);
}

export async function readQuestionnaireSummary(
  executor: Executor,
  questionnaireId: string,
): Promise<QuestionnaireSummary | undefined> {
  const [summary] = await selectQuestionnaireSummaries(executor, eq(questionnaire.id, questionnaireId));
  return summary;
}

export interface CreateQuestionnaireCommand {
  readonly questionnaireId?: string;
  readonly key: string | null;
  readonly name: string;
  readonly title: string;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export interface CreatedQuestionnaire {
  readonly questionnaireId: string;
  readonly draftVersionId: string;
  readonly draftRevision: number;
  readonly summary: QuestionnaireSummary;
}

export async function createQuestionnaire(
  executor: Executor,
  command: CreateQuestionnaireCommand,
): Promise<CreatedQuestionnaire> {
  return executor.transaction(async (tx) => {
    const questionnaireId = command.questionnaireId ?? uuidv7();
    const draftVersionId = uuidv7();
    await tx.insert(questionnaire).values({ id: questionnaireId, key: command.key, name: command.name });
    const [draft] = await tx
      .insert(questionnaireVersion)
      .values({
        id: draftVersionId,
        questionnaireId,
        status: "draft",
        title: command.title,
        createdBy: command.createdBy,
      })
      .returning({ draftRevision: questionnaireVersion.draftRevision });
    const summary = await readQuestionnaireSummary(tx, questionnaireId);
    if (draft === undefined || summary === undefined) {
      throw new Error("creating a questionnaire returned no row");
    }
    await recordAudit(tx, {
      action: "create_draft",
      questionnaireId,
      questionnaireVersionId: draftVersionId,
      version: null,
      actorId: command.createdBy,
      summary: null,
      traceId: command.traceId,
    });
    return { questionnaireId, draftVersionId, draftRevision: draft.draftRevision, summary };
  });
}

export interface SetClosesAtCommand {
  readonly questionnaireId: string;
  readonly closesAt: Date | null;
  readonly actorId: string | null;
  readonly traceId: string | null;
}

export type SetClosesAtOutcome =
  | { readonly outcome: "updated"; readonly questionnaire: QuestionnaireSummary }
  | QuestionnaireNotFound;

export async function setClosesAt(executor: Executor, command: SetClosesAtCommand): Promise<SetClosesAtOutcome> {
  return withLockedQuestionnaire(executor, command.questionnaireId, async (tx, locked): Promise<SetClosesAtOutcome> => {
    await tx.update(questionnaire).set({ closesAt: command.closesAt }).where(eq(questionnaire.id, command.questionnaireId));
    const summary = await readQuestionnaireSummary(tx, command.questionnaireId);
    if (summary === undefined) {
      throw new Error("the locked questionnaire could not be read back");
    }

    const from = locked.closesAt?.toISOString() ?? null;
    const to = summary.closesAt;
    await recordAudit(tx, {
      action: to === null ? "reopen" : "retire",
      questionnaireId: command.questionnaireId,
      questionnaireVersionId: null,
      version: null,
      actorId: command.actorId,
      summary: { from, to },
      traceId: command.traceId,
    });

    return { outcome: "updated", questionnaire: summary };
  });
}
