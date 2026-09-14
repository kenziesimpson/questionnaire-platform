import type { QuestionnaireSummary } from "@qp/shared";
import { desc } from "drizzle-orm";
import type { Executor } from "../client.js";
import { questionnaire } from "../schema.js";
import { openDraftExists } from "./questionnaire-rows.js";

export async function listQuestionnaireSummaries(executor: Executor): Promise<QuestionnaireSummary[]> {
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
