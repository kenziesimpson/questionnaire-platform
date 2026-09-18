import { conditionsOf, type Condition, type DraftItem, type QuestionVersion, type QuestionnaireDraft } from "@qp/shared";
import { pinnedQuestionOf } from "./draft-changes";

export type Reference =
  | { kind: "earlier"; item: DraftItem; position: number; question: QuestionVersion }
  | { kind: "later"; item: DraftItem; position: number; question: QuestionVersion }
  | { kind: "unusable"; reason: "missing" | "type-mismatch"; position: number | null };

export function referenceOf(draft: QuestionnaireDraft, dependantId: string, condition: Condition): Reference {
  const dependantIndex = draft.items.findIndex((item) => item.itemId === dependantId);
  const index = draft.items.findIndex((item) => item.itemId === condition.itemId);
  const item = draft.items[index];
  if (item === undefined) return { kind: "unusable", reason: "missing", position: null };
  const question = pinnedQuestionOf(draft, item);
  const position = index + 1;
  if (question === undefined || question.type !== condition.type) {
    return { kind: "unusable", reason: "type-mismatch", position };
  }
  return { kind: index < dependantIndex ? "earlier" : "later", item, position, question };
}

export interface EarlierItem {
  item: DraftItem;
  position: number;
  question: QuestionVersion;
}

export function earlierItemsThan(draft: QuestionnaireDraft, itemId: string): EarlierItem[] {
  const dependantIndex = draft.items.findIndex((item) => item.itemId === itemId);
  return draft.items.slice(0, Math.max(dependantIndex, 0)).flatMap((item, index) => {
    const question = pinnedQuestionOf(draft, item);
    return question === undefined ? [] : [{ item, position: index + 1, question }];
  });
}

export function listOfPositions(positions: readonly number[]) {
  const unique = [...new Set(positions)];
  if (unique.length === 1) return `question ${unique[0]}`;
  return `questions ${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

export function laterReferencesIn(draft: QuestionnaireDraft, item: DraftItem): number[] {
  return conditionsOf(item.visibleWhen).flatMap((condition) => {
    const reference = referenceOf(draft, item.itemId, condition);
    return reference.kind === "later" ? [reference.position] : [];
  });
}
