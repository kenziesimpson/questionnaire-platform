import { referencedOptionIds, type Condition, type QuestionVersion } from "@qp/shared";

export type Operator = Condition["op"];

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

export const UNSET_NUMBER = Number.NaN;
export const UNSET_DATE = "";

export function defaultConditionFor(itemId: string, question: QuestionVersion): Condition {
  switch (question.type) {
    case "text":
      return { type: "text", itemId, op: "answered", value: true };
    case "single_choice":
      return { type: "single_choice", itemId, op: "is", optionId: question.options[0]?.optionId ?? "" };
    case "multiple_choice":
      return { type: "multiple_choice", itemId, op: "includes", optionId: question.options[0]?.optionId ?? "" };
    case "number":
      return { type: "number", itemId, op: "eq", value: question.min ?? question.max ?? UNSET_NUMBER };
    case "date":
      return { type: "date", itemId, op: "onOrAfter", date: question.min ?? question.max ?? UNSET_DATE };
  }
}

const isSetDate = (date: string) => date !== UNSET_DATE;

export function isComplete(condition: Condition): boolean {
  switch (condition.type) {
    case "text":
    case "single_choice":
    case "multiple_choice":
      return true;
    case "number":
      return condition.op === "between"
        ? Number.isFinite(condition.min) && Number.isFinite(condition.max)
        : Number.isFinite(condition.value);
    case "date":
      return condition.op === "between" ? isSetDate(condition.min) && isSetDate(condition.max) : isSetDate(condition.date);
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

export function withOperator(condition: Condition, op: Operator): Condition {
  const { itemId } = condition;
  switch (condition.type) {
    case "text":
      return condition;
    case "single_choice": {
      const ids = [...referencedOptionIds(condition)];
      if (isOneOf(op, SINGLE_OPTION_CHOICE)) return { type: "single_choice", itemId, op, optionId: ids[0] ?? "" };
      if (isOneOf(op, MANY_OPTION_CHOICE)) return { type: "single_choice", itemId, op, optionIds: ids };
      return condition;
    }
    case "multiple_choice": {
      const ids = [...referencedOptionIds(condition)];
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
