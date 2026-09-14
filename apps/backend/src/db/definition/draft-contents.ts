import type { DraftForValidation, DraftItem, DraftItemCode, Item, ItemError, Predicate, QuestionVersion } from "@qp/shared";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Executor, Transaction } from "../client.js";
import { question, questionnaireItem } from "../schema.js";
import { storedQuestionToContent, storedQuestionToVersion } from "./question-content.js";
import { pinnedByDraft, questionVersionKey, readQuestionVersions, type LoadedQuestionVersion } from "./question-versions.js";

export type DraftInvalidItem = ItemError<DraftItemCode>;

export interface DraftContents {
  readonly items: readonly DraftItem[];
  readonly pinned: ReadonlyMap<string, LoadedQuestionVersion>;
}

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

export async function readDraftContents(executor: Executor, draftVersionId: string): Promise<DraftContents> {
  return {
    items: await readItems(executor, draftVersionId),
    pinned: await readQuestionVersions(executor, pinnedByDraft(draftVersionId)),
  };
}

function pinnedFor(contents: DraftContents, item: DraftItem): LoadedQuestionVersion {
  const loaded = contents.pinned.get(questionVersionKey({ questionId: item.questionId, version: item.questionVersion }));
  if (loaded === undefined) {
    throw new Error("a draft item pins a question version that does not exist");
  }
  return loaded;
}

export function pinnedQuestionVersionsInPlacementOrder(contents: DraftContents): QuestionVersion[] {
  const firstPlacements = new Map<string, DraftItem>();
  for (const item of contents.items) {
    const key = questionVersionKey({ questionId: item.questionId, version: item.questionVersion });
    if (!firstPlacements.has(key)) {
      firstPlacements.set(key, item);
    }
  }
  return [...firstPlacements.values()].map((item) => {
    const { stored, options } = pinnedFor(contents, item);
    return storedQuestionToVersion(stored, options);
  });
}

export function itemsWithQuestionContent(contents: DraftContents): Item[] {
  return contents.items.map((item) => {
    const { stored, options } = pinnedFor(contents, item);
    return {
      itemId: item.itemId,
      required: item.required,
      visibleWhen: item.visibleWhen,
      question: storedQuestionToContent(stored, options),
    };
  });
}

export async function archivedQuestionIds(executor: Executor, questionIds: readonly string[]): Promise<Set<string>> {
  const distinct = [...new Set(questionIds)];
  if (distinct.length === 0) {
    return new Set();
  }
  const archived = await executor
    .select({ id: question.id })
    .from(question)
    .where(and(inArray(question.id, distinct), isNotNull(question.archivedAt)));
  return new Set(archived.map((row) => row.id));
}

export async function draftForValidation(executor: Executor, items: readonly Item[]): Promise<DraftForValidation> {
  return {
    items: items.map((item) => ({
      itemId: item.itemId,
      required: item.required,
      visibleWhen: item.visibleWhen,
      questionId: item.question.questionId,
      questionVersion: item.question.questionVersion,
    })),
    questions: items.map((item) => item.question),
    archivedQuestionIds: await archivedQuestionIds(executor, items.map((item) => item.question.questionId)),
  };
}
