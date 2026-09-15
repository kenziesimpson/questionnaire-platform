import type { Condition, ConditionOf, DraftItem, QuestionVersion, QuestionnaireDraft, ResponseType } from "@qp/shared";
import { conditionsOf, pinnedQuestionOf } from "./draft-changes";

export type Operator = Condition["op"];
type OperatorOf<T extends ResponseType> = ConditionOf<T>["op"];

export const OPERATORS: { readonly [T in ResponseType]: readonly OperatorOf<T>[] } = {
  text: ["answered"],
  single_choice: ["is", "isNot", "isAnyOf", "isNoneOf"],
  multiple_choice: ["includes", "excludes", "includesAnyOf", "includesAllOf"],
  number: ["eq", "neq", "lt", "lte", "gt", "gte", "between"],
  date: ["before", "onOrBefore", "after", "onOrAfter", "between"],
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  answered: "is",
  is: "is",
  isNot: "is not",
  isAnyOf: "is any of",
  isNoneOf: "is none of",
  includes: "includes",
  excludes: "excludes",
  includesAnyOf: "includes any of",
  includesAllOf: "includes all of",
  eq: "equals",
  neq: "does not equal",
  lt: "is less than",
  lte: "is at most",
  gt: "is more than",
  gte: "is at least",
  between: "is between",
  before: "is before",
  onOrBefore: "is on or before",
  after: "is after",
  onOrAfter: "is on or after",
};

export function operatorsFor(type: ResponseType): readonly Operator[] {
  return OPERATORS[type];
}

export function defaultConditionFor(itemId: string, question: QuestionVersion, today: string): Condition {
  switch (question.type) {
    case "text":
      return { type: "text", itemId, op: "answered", value: true };
    case "single_choice":
      return { type: "single_choice", itemId, op: "is", optionId: question.options[0]?.optionId ?? "" };
    case "multiple_choice":
      return { type: "multiple_choice", itemId, op: "includes", optionId: question.options[0]?.optionId ?? "" };
    case "number":
      return { type: "number", itemId, op: "eq", value: question.min ?? 0 };
    case "date":
      return { type: "date", itemId, op: "onOrAfter", date: question.min ?? question.max ?? today };
  }
}

const isOneOf = <T extends Operator>(op: Operator, candidates: readonly T[]): op is T =>
  candidates.some((candidate) => candidate === op);

const SINGLE_OPTION_CHOICE = ["is", "isNot"] as const;
const MANY_OPTION_CHOICE = ["isAnyOf", "isNoneOf"] as const;
const SINGLE_OPTION_MULTIPLE = ["includes", "excludes"] as const;
const MANY_OPTION_MULTIPLE = ["includesAnyOf", "includesAllOf"] as const;
const NUMBER_COMPARISONS = ["eq", "neq", "lt", "lte", "gt", "gte"] as const;
const DATE_COMPARISONS = ["before", "onOrBefore", "after", "onOrAfter"] as const;

function optionIdsIn(condition: { optionId: string } | { optionIds: string[] }): string[] {
  return "optionIds" in condition ? condition.optionIds : [condition.optionId];
}

export function withOperator(condition: Condition, op: Operator): Condition {
  const { itemId } = condition;
  switch (condition.type) {
    case "text":
      return condition;
    case "single_choice": {
      const ids = optionIdsIn(condition);
      if (isOneOf(op, SINGLE_OPTION_CHOICE)) return { type: "single_choice", itemId, op, optionId: ids[0] ?? "" };
      if (isOneOf(op, MANY_OPTION_CHOICE)) return { type: "single_choice", itemId, op, optionIds: ids };
      return condition;
    }
    case "multiple_choice": {
      const ids = optionIdsIn(condition);
      if (isOneOf(op, SINGLE_OPTION_MULTIPLE)) return { type: "multiple_choice", itemId, op, optionId: ids[0] ?? "" };
      if (isOneOf(op, MANY_OPTION_MULTIPLE)) return { type: "multiple_choice", itemId, op, optionIds: ids };
      return condition;
    }
    case "number": {
      const [low, high] = condition.op === "between" ? [condition.min, condition.max] : [condition.value, condition.value];
      if (op === "between") return { type: "number", itemId, op, min: low, max: high };
      if (isOneOf(op, NUMBER_COMPARISONS)) return { type: "number", itemId, op, value: low };
      return condition;
    }
    case "date": {
      const [low, high] = condition.op === "between" ? [condition.min, condition.max] : [condition.date, condition.date];
      if (op === "between") return { type: "date", itemId, op, min: low, max: high };
      if (isOneOf(op, DATE_COMPARISONS)) return { type: "date", itemId, op, date: low };
      return condition;
    }
  }
}

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
