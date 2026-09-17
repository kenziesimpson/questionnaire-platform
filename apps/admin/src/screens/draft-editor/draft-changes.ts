import type { Condition, DraftItem, Predicate, QuestionVersion, QuestionnaireDraft } from "@qp/shared";
import type { DraftChange } from "../../api/use-draft-mutation";
import { generateUnusedId, randomSuffix } from "../../components/generated-id";

const GENERATED_PREFIX = "itm_";

export function generateItemId(taken: ReadonlySet<string>, suffix: () => string = randomSuffix): string {
  return generateUnusedId(GENERATED_PREFIX, taken, suffix);
}

export function conditionsOf(predicate: Predicate | null): Condition[] {
  if (predicate === null) return [];
  return "all" in predicate ? predicate.all : predicate.any;
}

export function pinnedQuestionOf(draft: QuestionnaireDraft, item: DraftItem): QuestionVersion | undefined {
  return draft.questions.find(
    (question) => question.questionId === item.questionId && question.questionVersion === item.questionVersion,
  );
}

export function promptOf(draft: QuestionnaireDraft, item: DraftItem): string {
  return pinnedQuestionOf(draft, item)?.prompt ?? "Unknown question";
}

function withQuestion(questions: readonly QuestionVersion[], added: QuestionVersion): QuestionVersion[] {
  const known = questions.some(
    ({ questionId, questionVersion }) => questionId === added.questionId && questionVersion === added.questionVersion,
  );
  return known ? [...questions] : [...questions, added];
}

function updateItem(draft: QuestionnaireDraft, itemId: string, update: (item: DraftItem) => DraftItem): QuestionnaireDraft {
  return { ...draft, items: draft.items.map((item) => (item.itemId === itemId ? update(item) : item)) };
}

export function isPlaced(draft: QuestionnaireDraft, questionId: string): boolean {
  return draft.items.some((item) => item.questionId === questionId);
}

export function addItem(question: QuestionVersion, suffix?: () => string): DraftChange {
  return (draft: QuestionnaireDraft): QuestionnaireDraft => {
    const itemId = generateItemId(new Set(draft.items.map((item) => item.itemId)), suffix);
    const item: DraftItem = {
      itemId,
      required: true,
      visibleWhen: null,
      questionId: question.questionId,
      questionVersion: question.questionVersion,
    };
    return { ...draft, items: [...draft.items, item], questions: withQuestion(draft.questions, question) };
  };
}

export function moveItem(itemId: string, toIndex: number): DraftChange {
  return (draft: QuestionnaireDraft): QuestionnaireDraft => {
    const from = draft.items.findIndex((item) => item.itemId === itemId);
    const moving = draft.items[from];
    if (moving === undefined || toIndex < 0 || toIndex >= draft.items.length || toIndex === from) return draft;
    const rest = draft.items.filter((item) => item.itemId !== itemId);
    return { ...draft, items: [...rest.slice(0, toIndex), moving, ...rest.slice(toIndex)] };
  };
}

function withoutReferencesTo(itemId: string, predicate: Predicate | null): Predicate | null {
  if (predicate === null) return null;
  const kept = conditionsOf(predicate).filter((condition) => condition.itemId !== itemId);
  if (kept.length === 0) return null;
  return "all" in predicate ? { all: kept } : { any: kept };
}

export function dependantsOf(draft: QuestionnaireDraft, itemId: string): DraftItem[] {
  return draft.items.filter((item) => conditionsOf(item.visibleWhen).some((condition) => condition.itemId === itemId));
}

export function removeItem(itemId: string): DraftChange {
  return (draft: QuestionnaireDraft): QuestionnaireDraft => ({
    ...draft,
    items: draft.items
      .filter((item) => item.itemId !== itemId)
      .map((item) => ({ ...item, visibleWhen: withoutReferencesTo(itemId, item.visibleWhen) })),
  });
}

export function repinItem(itemId: string, question: QuestionVersion): DraftChange {
  return (draft: QuestionnaireDraft): QuestionnaireDraft => ({
    ...updateItem(draft, itemId, (item) =>
      item.questionId === question.questionId ? { ...item, questionVersion: question.questionVersion } : item,
    ),
    questions: withQuestion(draft.questions, question),
  });
}

export function setRequired(itemId: string, required: boolean): DraftChange {
  return (draft: QuestionnaireDraft): QuestionnaireDraft => updateItem(draft, itemId, (item) => ({ ...item, required }));
}

export function setVisibleWhen(itemId: string, visibleWhen: Predicate | null): DraftChange {
  return (draft: QuestionnaireDraft): QuestionnaireDraft =>
    updateItem(draft, itemId, (item) => ({ ...item, visibleWhen }));
}
