import type { DraftItem } from "@qp/shared";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit.js";
import type { Executor } from "../client.js";
import { question, questionnaire, questionnaireItem, questionnaireVersion, questionVersion } from "../schema.js";

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
    await recordAudit(tx, {
      action: "create_draft",
      questionnaireId,
      questionnaireVersionId: draftVersionId,
      version: null,
      actorId: command.createdBy,
      summary: null,
      traceId: command.traceId,
    });
    return { questionnaireId, draftVersionId, draftRevision: draft?.draftRevision ?? 0 };
  });
}

export interface AppendDraftItemsCommand {
  readonly questionnaireId: string;
  readonly expectedDraftRevision: number;
  readonly items: readonly DraftItem[];
  readonly actorId: string | null;
  readonly traceId: string | null;
}

export type AppendDraftItemsOutcome =
  | { readonly outcome: "saved"; readonly draftVersionId: string; readonly draftRevision: number }
  | { readonly outcome: "stale-or-missing-draft" }
  | { readonly outcome: "archived-question"; readonly questionIds: readonly string[] }
  | { readonly outcome: "unknown-question-version"; readonly itemIds: readonly string[] };

export async function appendDraftItems(
  executor: Executor,
  command: AppendDraftItemsCommand,
): Promise<AppendDraftItemsOutcome> {
  return executor.transaction(async (tx) => {
    const questionIds = [...new Set(command.items.map((item) => item.questionId))];
    if (questionIds.length > 0) {
      const archived = await tx
        .select({ id: question.id })
        .from(question)
        .where(and(inArray(question.id, questionIds), isNotNull(question.archivedAt)));
      if (archived.length > 0) {
        return { outcome: "archived-question", questionIds: archived.map((row) => row.id) };
      }
      const known = await tx
        .select({ questionId: questionVersion.questionId, version: questionVersion.version })
        .from(questionVersion)
        .where(inArray(questionVersion.questionId, questionIds));
      const knownKeys = new Set(known.map((row) => `${row.questionId}:${row.version}`));
      const unknownItemIds = command.items
        .filter((item) => !knownKeys.has(`${item.questionId}:${item.questionVersion}`))
        .map((item) => item.itemId);
      if (unknownItemIds.length > 0) {
        return { outcome: "unknown-question-version", itemIds: unknownItemIds };
      }
    }

    const [draft] = await tx
      .update(questionnaireVersion)
      .set({
        draftRevision: sql`${questionnaireVersion.draftRevision} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(questionnaireVersion.questionnaireId, command.questionnaireId),
          eq(questionnaireVersion.status, "draft"),
          eq(questionnaireVersion.draftRevision, command.expectedDraftRevision),
        ),
      )
      .returning({ id: questionnaireVersion.id, draftRevision: questionnaireVersion.draftRevision });
    if (draft === undefined) {
      return { outcome: "stale-or-missing-draft" };
    }

    const [last] = await tx
      .select({ next: sql<number>`coalesce(max(${questionnaireItem.position}) + 1, 0)` })
      .from(questionnaireItem)
      .where(eq(questionnaireItem.questionnaireVersionId, draft.id));
    const firstPosition = Number(last?.next ?? 0);
    if (command.items.length > 0) {
      await tx.insert(questionnaireItem).values(
        command.items.map((item, offset) => ({
          questionnaireVersionId: draft.id,
          itemId: item.itemId,
          position: firstPosition + offset,
          required: item.required,
          visibleWhen: item.visibleWhen,
          questionId: item.questionId,
          questionVersion: item.questionVersion,
        })),
      );
    }
    await recordAudit(tx, {
      action: "edit_draft",
      questionnaireId: command.questionnaireId,
      questionnaireVersionId: draft.id,
      version: null,
      actorId: command.actorId,
      summary: { addedItemIds: command.items.map((item) => item.itemId) },
      traceId: command.traceId,
    });
    return { outcome: "saved", draftVersionId: draft.id, draftRevision: draft.draftRevision };
  });
}
