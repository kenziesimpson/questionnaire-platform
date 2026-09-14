import type { QuestionnaireSummary } from "@qp/shared";
import { eq } from "drizzle-orm";
import { recordAudit } from "../audit.js";
import type { Executor } from "../client.js";
import { questionnaire } from "../schema.js";
import { hasOpenDraft, withLockedQuestionnaire, type QuestionnaireNotFound } from "./questionnaire-rows.js";

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
    const [updated] = await tx
      .update(questionnaire)
      .set({ closesAt: command.closesAt })
      .where(eq(questionnaire.id, command.questionnaireId))
      .returning();
    if (updated === undefined) {
      throw new Error("the locked questionnaire row was not updated");
    }

    const from = locked.closesAt?.toISOString() ?? null;
    const to = updated.closesAt?.toISOString() ?? null;
    await recordAudit(tx, {
      action: to === null ? "reopen" : "retire",
      questionnaireId: command.questionnaireId,
      questionnaireVersionId: null,
      version: null,
      actorId: command.actorId,
      summary: { from, to },
      traceId: command.traceId,
    });

    return {
      outcome: "updated",
      questionnaire: {
        questionnaireId: updated.id,
        key: updated.key,
        name: updated.name,
        currentVersion: updated.currentVersion,
        closesAt: to,
        hasDraft: await hasOpenDraft(tx, command.questionnaireId),
        createdAt: updated.createdAt.toISOString(),
      },
    };
  });
}
