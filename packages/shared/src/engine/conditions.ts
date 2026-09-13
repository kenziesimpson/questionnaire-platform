import type { ClientAnswerValue } from "../domain/answer.js";
import type { Condition, ConditionOf, Predicate } from "../domain/condition.js";
import { compareIsoDates } from "./calendar.js";
import { compareDecimalToNumber } from "./decimal.js";

export interface ReferencedItem {
  shown: boolean;
  answer: ClientAnswerValue | undefined;
}

type OrderTest = (order: number) => boolean;

const NUMBER_ORDER_TESTS = {
  eq: (order) => order === 0,
  neq: (order) => order !== 0,
  lt: (order) => order < 0,
  lte: (order) => order <= 0,
  gt: (order) => order > 0,
  gte: (order) => order >= 0,
} satisfies Record<Exclude<ConditionOf<"number">["op"], "between">, OrderTest>;

const DATE_ORDER_TESTS = {
  before: (order) => order < 0,
  onOrBefore: (order) => order <= 0,
  after: (order) => order > 0,
  onOrAfter: (order) => order >= 0,
} satisfies Record<Exclude<ConditionOf<"date">["op"], "between">, OrderTest>;

function singleChoiceHolds(condition: ConditionOf<"single_choice">, optionId: string): boolean {
  switch (condition.op) {
    case "is":
      return optionId === condition.optionId;
    case "isNot":
      return optionId !== condition.optionId;
    case "isAnyOf":
      return condition.optionIds.includes(optionId);
    case "isNoneOf":
      return !condition.optionIds.includes(optionId);
  }
}

function multipleChoiceHolds(condition: ConditionOf<"multiple_choice">, optionIds: readonly string[]): boolean {
  switch (condition.op) {
    case "includes":
      return optionIds.includes(condition.optionId);
    case "excludes":
      return !optionIds.includes(condition.optionId);
    case "includesAnyOf":
      return condition.optionIds.some((id) => optionIds.includes(id));
    case "includesAllOf":
      return condition.optionIds.every((id) => optionIds.includes(id));
  }
}

function numberHolds(condition: ConditionOf<"number">, value: string): boolean {
  if (condition.op === "between") {
    const fromMin = compareDecimalToNumber(value, condition.min);
    const toMax = compareDecimalToNumber(value, condition.max);
    return fromMin !== undefined && toMax !== undefined && fromMin >= 0 && toMax <= 0;
  }
  const order = compareDecimalToNumber(value, condition.value);
  return order !== undefined && NUMBER_ORDER_TESTS[condition.op](order);
}

function dateHolds(condition: ConditionOf<"date">, date: string): boolean {
  if (condition.op === "between") {
    return compareIsoDates(date, condition.min) >= 0 && compareIsoDates(date, condition.max) <= 0;
  }
  return DATE_ORDER_TESTS[condition.op](compareIsoDates(date, condition.date));
}

export function conditionHolds(condition: Condition, referenced: ReferencedItem): boolean {
  if (!referenced.shown) return false;
  const { answer } = referenced;
  switch (condition.type) {
    case "text":
      return condition.value ? answer?.type === "text" : answer === undefined;
    case "single_choice":
      return answer?.type === "single_choice" && singleChoiceHolds(condition, answer.optionId);
    case "multiple_choice":
      return answer?.type === "multiple_choice" && multipleChoiceHolds(condition, answer.optionIds);
    case "number":
      return answer?.type === "number" && numberHolds(condition, answer.value);
    case "date":
      return answer?.type === "date" && dateHolds(condition, answer.date);
  }
}

export function predicateHolds(predicate: Predicate | null, reference: (itemId: string) => ReferencedItem): boolean {
  if (predicate === null) return true;
  if ("all" in predicate) return predicate.all.every((condition) => conditionHolds(condition, reference(condition.itemId)));
  return predicate.any.some((condition) => conditionHolds(condition, reference(condition.itemId)));
}
