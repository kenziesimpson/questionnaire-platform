import type { QuestionnaireSummary } from "@qp/shared";
import { and, desc, eq, exists } from "drizzle-orm";
import type { Executor } from "../client.js";
import { questionnaire, questionnaireVersion } from "../schema.js";

export async function listQuestionnaireSummaries(executor: Executor): Promise<QuestionnaireSummary[]> {
  const draftExists = exists(
    executor
      .select({ id: questionnaireVersion.id })
      .from(questionnaireVersion)
      .where(and(eq(questionnaireVersion.questionnaireId, questionnaire.id), eq(questionnaireVersion.status, "draft"))),
  ).mapWith(Boolean);

  const rows = await executor
    .select({
      questionnaireId: questionnaire.id,
      key: questionnaire.key,
      name: questionnaire.name,
      currentVersion: questionnaire.currentVersion,
      closesAt: questionnaire.closesAt,
      hasDraft: draftExists,
      createdAt: questionnaire.createdAt,
    })
    .from(questionnaire)
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
