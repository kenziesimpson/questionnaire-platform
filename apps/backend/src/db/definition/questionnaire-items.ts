import type { DraftItem, Predicate } from "@qp/shared";
import { asc, eq } from "drizzle-orm";
import type { Executor, Transaction } from "../client.js";
import { questionnaireItem } from "../schema.js";

export async function readItems(executor: Executor, questionnaireVersionId: string): Promise<DraftItem[]> {
  const rows = await executor
    .select({
      itemId: questionnaireItem.itemId,
      required: questionnaireItem.required,
      visibleWhen: questionnaireItem.visibleWhen,
      questionId: questionnaireItem.questionId,
      questionVersion: questionnaireItem.questionVersion,
    })
    .from(questionnaireItem)
    .where(eq(questionnaireItem.questionnaireVersionId, questionnaireVersionId))
    .orderBy(asc(questionnaireItem.position));
  return rows.map((row) => ({ ...row, visibleWhen: row.visibleWhen as Predicate | null }));
}

export async function insertItems(tx: Transaction, questionnaireVersionId: string, items: readonly DraftItem[]): Promise<void> {
  if (items.length === 0) {
    return;
  }
  await tx.insert(questionnaireItem).values(
    items.map((item, position) => ({
      questionnaireVersionId,
      itemId: item.itemId,
      position,
      required: item.required,
      visibleWhen: item.visibleWhen,
      questionId: item.questionId,
      questionVersion: item.questionVersion,
    })),
  );
}
