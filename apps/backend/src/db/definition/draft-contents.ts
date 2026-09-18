import type { DraftItem, DraftItemCode, Item, ItemError, QuestionVersion } from "@qp/shared";
import type { Executor } from "../client.js";
import { readItems } from "./questionnaire-items.js";
import { storedQuestionToContent, storedQuestionToVersion } from "./question-content.js";
import { pinnedByDraft, questionVersionKey, readQuestionVersions, type LoadedQuestionVersion } from "./question-versions.js";

export type DraftInvalidItem = ItemError<DraftItemCode>;

export interface DraftContents {
  readonly items: readonly DraftItem[];
  readonly pinned: ReadonlyMap<string, LoadedQuestionVersion>;
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
