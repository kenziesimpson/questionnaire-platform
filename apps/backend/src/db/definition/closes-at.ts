import type { QuestionnaireSummary } from "@qp/shared";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "../audit.js";
import type { Executor, Transaction } from "../client.js";
import { questionnaire, questionnaireVersion } from "../schema.js";

export interface SetClosesAtCommand {
  readonly questionnaireId: string;
  readonly closesAt: Date | null;
  readonly actorId: string | null;
  readonly traceId: string | null;
}

export type SetClosesAtOutcome =
  | { readonly outcome: "updated"; readonly questionnaire: QuestionnaireSummary }
  | { readonly outcome: "questionnaire-not-found" };

async function lockClosesAt(tx: Transaction, questionnaireId: string): Promise<{ closesAt: Date | null } | undefined> {
  const [locked] = await tx
    .select({ closesAt: questionnaire.closesAt })
    .from(questionnaire)
    .where(eq(questionnaire.id, questionnaireId))
    .for("update");
  return locked;
}

async function hasOpenDraft(tx: Transaction, questionnaireId: string): Promise<boolean> {
  const drafts = await tx
    .select({ id: questionnaireVersion.id })
    .from(questionnaireVersion)
    .where(and(eq(questionnaireVersion.questionnaireId, questionnaireId), eq(questionnaireVersion.status, "draft")));
  return drafts.length > 0;
}

export async function setClosesAt(executor: Executor, command: SetClosesAtCommand): Promise<SetClosesAtOutcome> {
  return executor.transaction(async (tx) => {
    const locked = await lockClosesAt(tx, command.questionnaireId);
    if (locked === undefined) {
      return { outcome: "questionnaire-not-found" };
    }

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
