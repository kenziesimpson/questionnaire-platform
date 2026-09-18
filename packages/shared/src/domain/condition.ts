import Type, { type Static } from "typebox";
import { IsoDate, Slug, strict } from "../primitives.js";
import type { ResponseType } from "./question.js";

/**
 * Conditions are discriminated by the response type of the item they reference, so the operator
 * set and operand type travel together and a date compared against a number cannot be built
 * (Decisions Log #9). A condition names an `itemId` — a placement — never a `questionId` (#41).
 * `type` must equal the type of the question version the referenced item pins ([[5-questionnaire-format]] §5.4).
 */
const OptionIds = Type.Array(Slug, { minItems: 1, uniqueItems: true });

export const TextCondition = Type.Object(
  {
    type: Type.Literal("text"),
    itemId: Slug,
    op: Type.Literal("answered"),
    value: Type.Boolean(),
  },
  strict,
);

export const SingleChoiceCondition = Type.Union([
  Type.Object(
    {
      type: Type.Literal("single_choice"),
      itemId: Slug,
      op: Type.Union([Type.Literal("is"), Type.Literal("isNot")]),
      optionId: Slug,
    },
    strict,
  ),
  Type.Object(
    {
      type: Type.Literal("single_choice"),
      itemId: Slug,
      op: Type.Union([Type.Literal("isAnyOf"), Type.Literal("isNoneOf")]),
      optionIds: OptionIds,
    },
    strict,
  ),
]);

export const MultipleChoiceCondition = Type.Union([
  Type.Object(
    {
      type: Type.Literal("multiple_choice"),
      itemId: Slug,
      op: Type.Union([Type.Literal("includes"), Type.Literal("excludes")]),
      optionId: Slug,
    },
    strict,
  ),
  Type.Object(
    {
      type: Type.Literal("multiple_choice"),
      itemId: Slug,
      op: Type.Union([Type.Literal("includesAnyOf"), Type.Literal("includesAllOf")]),
      optionIds: OptionIds,
    },
    strict,
  ),
]);

/** Operands are in the referenced question's unit, which its pinned version fixes. `between` is inclusive. */
export const NumberCondition = Type.Union([
  Type.Object(
    {
      type: Type.Literal("number"),
      itemId: Slug,
      op: Type.Union([
        Type.Literal("eq"),
        Type.Literal("neq"),
        Type.Literal("lt"),
        Type.Literal("lte"),
        Type.Literal("gt"),
        Type.Literal("gte"),
      ]),
      value: Type.Number(),
    },
    strict,
  ),
  Type.Object(
    { type: Type.Literal("number"), itemId: Slug, op: Type.Literal("between"), min: Type.Number(), max: Type.Number() },
    strict,
  ),
]);

/** `between` is inclusive. */
export const DateCondition = Type.Union([
  Type.Object(
    {
      type: Type.Literal("date"),
      itemId: Slug,
      op: Type.Union([
        Type.Literal("before"),
        Type.Literal("onOrBefore"),
        Type.Literal("after"),
        Type.Literal("onOrAfter"),
      ]),
      date: IsoDate,
    },
    strict,
  ),
  Type.Object({ type: Type.Literal("date"), itemId: Slug, op: Type.Literal("between"), min: IsoDate, max: IsoDate }, strict),
]);

export const Condition = Type.Union([
  TextCondition,
  SingleChoiceCondition,
  MultipleChoiceCondition,
  NumberCondition,
  DateCondition,
]);
export type Condition = Static<typeof Condition>;
export type ConditionOf<T extends Condition["type"]> = Extract<Condition, { type: T }>;

/**
 * One level of `all` / `any`; no nesting ([[5-questionnaire-format]] §4.1). Empty groups are
 * representable so the engine's edge cases are testable; what they mean is the engine's to define.
 */
export const Predicate = Type.Union([
  Type.Object({ all: Type.Array(Condition) }, strict),
  Type.Object({ any: Type.Array(Condition) }, strict),
]);
export type Predicate = Static<typeof Predicate>;

export const OPERATORS_BY_TYPE: { readonly [T in ResponseType]: readonly ConditionOf<T>["op"][] } = {
  text: ["answered"],
  single_choice: ["is", "isNot", "isAnyOf", "isNoneOf"],
  multiple_choice: ["includes", "excludes", "includesAnyOf", "includesAllOf"],
  number: ["eq", "neq", "lt", "lte", "gt", "gte", "between"],
  date: ["before", "onOrBefore", "after", "onOrAfter", "between"],
};

export function conditionsOf(predicate: Predicate | null): readonly Condition[] {
  if (predicate === null) return [];
  return "all" in predicate ? predicate.all : predicate.any;
}

export function referencedOptionIds(condition: Condition): readonly string[] {
  if ("optionId" in condition) return [condition.optionId];
  if ("optionIds" in condition) return condition.optionIds;
  return [];
}
