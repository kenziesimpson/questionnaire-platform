import type { QuestionnaireSummary } from "@qp/shared";
import { eq } from "drizzle-orm";
import { recordAudit } from "../audit.js";
import type { Executor } from "../client.js";
import { questionnaire } from "../schema.js";
import { readQuestionnaireSummary } from "./questionnaires.js";
import { withLockedQuestionnaire, type QuestionnaireNotFound } from "./questionnaire-rows.js";

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
