import type { Condition, ConditionOf } from "../domain/condition.js";
import type { QuestionContent } from "../domain/question.js";
import { dayNumber } from "./calendar.js";

export type ConstraintTerm = ReadonlyMap<string, readonly Condition[]>;

type QuestionOf<T extends QuestionContent["type"]> = Extract<QuestionContent, { type: T }>;

interface Bound {
  value: number;
  inclusive: boolean;
}

interface Interval {
  lower: Bound | undefined;
  upper: Bound | undefined;
  punctures: number[];
}

function ofType<T extends Condition["type"]>(conditions: readonly Condition[], type: T): ConditionOf<T>[] {
  return conditions.filter((condition): condition is ConditionOf<T> => condition.type === type);
}

function textSatisfiable(conditions: readonly ConditionOf<"text">[]): boolean {
  return new Set(conditions.map((condition) => condition.value)).size <= 1;
}

function singleChoiceSatisfiable(question: QuestionOf<"single_choice">, conditions: readonly ConditionOf<"single_choice">[]): boolean {
  const allowed = new Set(question.options.map((option) => option.optionId));
  for (const condition of conditions) {
    switch (condition.op) {
      case "is":
        for (const id of allowed) if (id !== condition.optionId) allowed.delete(id);
        break;
      case "isNot":
        allowed.delete(condition.optionId);
        break;
      case "isAnyOf":
        for (const id of allowed) if (!condition.optionIds.includes(id)) allowed.delete(id);
        break;
      case "isNoneOf":
        for (const id of condition.optionIds) allowed.delete(id);
        break;
    }
  }
  return allowed.size > 0;
}

function minimumHittingSetSize(sets: readonly ReadonlySet<string>[]): number {
  const [first, ...rest] = sets;
  if (!first) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const pick of first) {
    best = Math.min(best, 1 + minimumHittingSetSize(rest.filter((set) => !set.has(pick))));
  }
  return best;
}

function multipleChoiceSatisfiable(
  question: QuestionOf<"multiple_choice">,
  conditions: readonly ConditionOf<"multiple_choice">[],
): boolean {
  const required = new Set<string>();
  const forbidden = new Set<string>();
  const atLeastOneOf: string[][] = [];
  for (const condition of conditions) {
    switch (condition.op) {
      case "includes":
        required.add(condition.optionId);
        break;
      case "excludes":
        forbidden.add(condition.optionId);
        break;
      case "includesAllOf":
        condition.optionIds.forEach((id) => required.add(id));
        break;
      case "includesAnyOf":
        atLeastOneOf.push(condition.optionIds);
        break;
    }
  }
  const selectable = question.options.map((option) => option.optionId).filter((id) => !forbidden.has(id));
  if ([...required].some((id) => !selectable.includes(id))) return false;
  const unhit = atLeastOneOf
    .filter((ids) => !ids.some((id) => required.has(id)))
    .map((ids) => new Set(ids.filter((id) => selectable.includes(id))));
  if (unhit.some((set) => set.size === 0)) return false;
  const fewest = Math.max(required.size + minimumHittingSetSize(unhit), question.minSelections ?? 0, 1);
  const most = Math.min(question.maxSelections ?? Number.POSITIVE_INFINITY, selectable.length);
  return fewest <= most;
}

function tighterLower(current: Bound | undefined, next: Bound): Bound {
  if (!current || next.value > current.value || (next.value === current.value && !next.inclusive)) return next;
  return current;
}

function tighterUpper(current: Bound | undefined, next: Bound): Bound {
  if (!current || next.value < current.value || (next.value === current.value && !next.inclusive)) return next;
  return current;
}

function numberInterval(question: QuestionOf<"number">, conditions: readonly ConditionOf<"number">[]): Interval {
  const interval: Interval = { lower: undefined, upper: undefined, punctures: [] };
  const atLeast = (value: number, inclusive: boolean) => (interval.lower = tighterLower(interval.lower, { value, inclusive }));
  const atMost = (value: number, inclusive: boolean) => (interval.upper = tighterUpper(interval.upper, { value, inclusive }));
  if (question.min !== undefined) atLeast(question.min, true);
  if (question.max !== undefined) atMost(question.max, true);
  for (const condition of conditions) {
    switch (condition.op) {
      case "eq":
        atLeast(condition.value, true);
        atMost(condition.value, true);
        break;
      case "neq":
        interval.punctures.push(condition.value);
        break;
      case "lt":
        atMost(condition.value, false);
        break;
      case "lte":
        atMost(condition.value, true);
        break;
      case "gt":
        atLeast(condition.value, false);
        break;
      case "gte":
        atLeast(condition.value, true);
        break;
      case "between":
        atLeast(condition.min, true);
        atMost(condition.max, true);
        break;
    }
  }
  return interval;
}

function realIntervalSatisfiable({ lower, upper, punctures }: Interval): boolean {
  if (!lower || !upper) return true;
  if (lower.value < upper.value) return true;
  return lower.value === upper.value && lower.inclusive && upper.inclusive && !punctures.includes(lower.value);
}

function integerIntervalSatisfiable({ lower, upper, punctures }: Interval): boolean {
  const lowest = !lower ? Number.NEGATIVE_INFINITY : lower.inclusive ? Math.ceil(lower.value) : Math.floor(lower.value) + 1;
  const highest = !upper ? Number.POSITIVE_INFINITY : upper.inclusive ? Math.floor(upper.value) : Math.ceil(upper.value) - 1;
  if (lowest > highest) return false;
  const excluded = new Set(punctures.filter((p) => Number.isInteger(p) && p >= lowest && p <= highest)).size;
  return highest - lowest + 1 > excluded;
}

function numberSatisfiable(question: QuestionOf<"number">, conditions: readonly ConditionOf<"number">[]): boolean {
  const interval = numberInterval(question, conditions);
  return question.numberKind === "integer" ? integerIntervalSatisfiable(interval) : realIntervalSatisfiable(interval);
}

function dateSatisfiable(question: QuestionOf<"date">, conditions: readonly ConditionOf<"date">[]): boolean {
  let lowest = question.min === undefined ? Number.NEGATIVE_INFINITY : dayNumber(question.min);
  let highest = question.max === undefined ? Number.POSITIVE_INFINITY : dayNumber(question.max);
  const atLeast = (day: number) => (lowest = Math.max(lowest, day));
  const atMost = (day: number) => (highest = Math.min(highest, day));
  for (const condition of conditions) {
    switch (condition.op) {
      case "before":
        atMost(dayNumber(condition.date) - 1);
        break;
      case "onOrBefore":
        atMost(dayNumber(condition.date));
        break;
      case "after":
        atLeast(dayNumber(condition.date) + 1);
        break;
      case "onOrAfter":
        atLeast(dayNumber(condition.date));
        break;
      case "between":
        atLeast(dayNumber(condition.min));
        atMost(dayNumber(condition.max));
        break;
    }
  }
  return lowest <= highest;
}

function domainSatisfiable(question: QuestionContent, conditions: readonly Condition[]): boolean {
  switch (question.type) {
    case "text":
      return textSatisfiable(ofType(conditions, "text"));
    case "single_choice":
      return singleChoiceSatisfiable(question, ofType(conditions, "single_choice"));
    case "multiple_choice":
      return multipleChoiceSatisfiable(question, ofType(conditions, "multiple_choice"));
    case "number":
      return numberSatisfiable(question, ofType(conditions, "number"));
    case "date":
      return dateSatisfiable(question, ofType(conditions, "date"));
  }
}

export function isTermSatisfiable(
  term: ConstraintTerm,
  questionOf: (itemId: string) => QuestionContent | undefined,
): boolean {
  for (const [itemId, conditions] of term) {
    const question = questionOf(itemId);
    if (!question || !domainSatisfiable(question, conditions)) return false;
  }
  return true;
}

export function termOf(conditions: readonly Condition[]): ConstraintTerm {
  return mergeTerms(...conditions.map((condition) => new Map([[condition.itemId, [condition]]])));
}

export function mergeTerms(...terms: ConstraintTerm[]): ConstraintTerm {
  const merged = new Map<string, Map<string, Condition>>();
  for (const term of terms) {
    for (const [itemId, conditions] of term) {
      const byKey = merged.get(itemId) ?? new Map<string, Condition>();
      for (const condition of conditions) byKey.set(JSON.stringify(condition), condition);
      merged.set(itemId, byKey);
    }
  }
  return new Map([...merged].map(([itemId, byKey]) => [itemId, [...byKey.values()]]));
}

export function termKey(term: ConstraintTerm): string {
  const entries = [...term]
    .map(([itemId, conditions]) => [itemId, conditions.map((condition) => JSON.stringify(condition)).sort()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}
