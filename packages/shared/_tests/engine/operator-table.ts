import type { ClientAnswerValue } from "../../src/domain/answer.js";
import type { Condition } from "../../src/domain/condition.js";

export const SOURCE_BY_TYPE = {
  text: "src_text",
  single_choice: "src_single",
  multiple_choice: "src_multi",
  number: "src_number",
  date: "src_date",
} as const satisfies Record<Condition["type"], string>;

const text = (op: "answered" | "notAnswered"): Condition => ({ type: "text", itemId: "src_text", op });
const single = (op: "is" | "isNot", optionId: string): Condition => ({ type: "single_choice", itemId: "src_single", op, optionId });
const singleList = (op: "isAnyOf" | "isNoneOf", optionIds: string[]): Condition => ({ type: "single_choice", itemId: "src_single", op, optionIds });
const multi = (op: "includes" | "excludes", optionId: string): Condition => ({ type: "multiple_choice", itemId: "src_multi", op, optionId });
const multiList = (op: "includesAnyOf" | "includesAllOf", optionIds: string[]): Condition => ({ type: "multiple_choice", itemId: "src_multi", op, optionIds });
const num = (op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte", value: number): Condition => ({ type: "number", itemId: "src_number", op, value });
const numBetween = (min: number, max: number): Condition => ({ type: "number", itemId: "src_number", op: "between", min, max });
const date = (op: "before" | "onOrBefore" | "after" | "onOrAfter", on: string): Condition => ({ type: "date", itemId: "src_date", op, date: on });
const dateBetween = (min: string, max: string): Condition => ({ type: "date", itemId: "src_date", op: "between", min, max });

export const conditions = { text, single, singleList, multi, multiList, num, date };

export const textAnswer = (value: string): ClientAnswerValue => ({ type: "text", text: value });
export const pick = (optionId: string): ClientAnswerValue => ({ type: "single_choice", optionId });
export const picks = (...optionIds: string[]): ClientAnswerValue => ({ type: "multiple_choice", optionIds });
export const decimal = (value: string): ClientAnswerValue => ({ type: "number", value });
export const day = (value: string): ClientAnswerValue => ({ type: "date", date: value });

export type OperatorCase = [label: string, condition: Condition, answer: ClientAnswerValue, holds: boolean];

export const OPERATOR_CASES: OperatorCase[] = [
  ["text answered, answered", text("answered"), textAnswer("Boots"), true],
  ["text notAnswered, answered", text("notAnswered"), textAnswer("Boots"), false],
  ["single_choice is, matching", single("is", "a"), pick("a"), true],
  ["single_choice is, other option", single("is", "a"), pick("b"), false],
  ["single_choice isNot, matching", single("isNot", "a"), pick("a"), false],
  ["single_choice isNot, other option", single("isNot", "a"), pick("b"), true],
  ["single_choice isAnyOf, in set", singleList("isAnyOf", ["a", "b"]), pick("b"), true],
  ["single_choice isAnyOf, outside set", singleList("isAnyOf", ["a", "b"]), pick("c"), false],
  ["single_choice isNoneOf, outside set", singleList("isNoneOf", ["a", "b"]), pick("c"), true],
  ["single_choice isNoneOf, in set", singleList("isNoneOf", ["a", "b"]), pick("a"), false],
  ["multiple_choice includes, selected", multi("includes", "a"), picks("a", "b"), true],
  ["multiple_choice includes, not selected", multi("includes", "a"), picks("b"), false],
  ["multiple_choice excludes, not selected", multi("excludes", "a"), picks("b"), true],
  ["multiple_choice excludes, selected", multi("excludes", "a"), picks("c", "a"), false],
  ["multiple_choice includesAnyOf, one selected", multiList("includesAnyOf", ["a", "b"]), picks("b", "c"), true],
  ["multiple_choice includesAnyOf, none selected", multiList("includesAnyOf", ["a", "b"]), picks("c"), false],
  ["multiple_choice includesAllOf, all selected", multiList("includesAllOf", ["a", "b"]), picks("b", "c", "a"), true],
  ["multiple_choice includesAllOf, one missing", multiList("includesAllOf", ["a", "b"]), picks("a", "c"), false],
  ["number eq, equal", num("eq", 18), decimal("18"), true],
  ["number eq, equal with trailing zeros", num("eq", 18), decimal("18.00"), true],
  ["number eq, different", num("eq", 18), decimal("18.5"), false],
  ["number neq, different", num("neq", 18), decimal("19"), true],
  ["number neq, equal", num("neq", 18), decimal("18"), false],
  ["number lt, below", num("lt", 18), decimal("17.99"), true],
  ["number lt, equal", num("lt", 18), decimal("18"), false],
  ["number lte, equal", num("lte", 18), decimal("18"), true],
  ["number lte, above", num("lte", 18), decimal("18.01"), false],
  ["number gt, above", num("gt", 18), decimal("18.01"), true],
  ["number gt, equal", num("gt", 18), decimal("18"), false],
  ["number gte, equal", num("gte", 18), decimal("18"), true],
  ["number gte, below", num("gte", 18), decimal("17.9"), false],
  ["number lt, negative operand", num("lt", -2.5), decimal("-3"), true],
  ["number eq 0.1 against the decimal the author wrote", num("eq", 0.1), decimal("0.1"), true],
  ["number lt 0.1 is not satisfied by 0.1", num("lt", 0.1), decimal("0.1"), false],
  ["number gt 1e21 compares exactly beyond double precision", num("gt", 1e21), decimal("1000000000000000000001"), true],
  ["number gt 1e-7 in exponent form", num("gt", 1e-7), decimal("0.00000011"), true],
  ["number between, at min", numBetween(1.5, 2.5), decimal("1.5"), true],
  ["number between, at max", numBetween(1.5, 2.5), decimal("2.50"), true],
  ["number between, above", numBetween(1.5, 2.5), decimal("2.51"), false],
  ["number between, below", numBetween(1.5, 2.5), decimal("1.49"), false],
  ["date before, earlier", date("before", "2020-01-01"), day("2019-12-31"), true],
  ["date before, same day", date("before", "2020-01-01"), day("2020-01-01"), false],
  ["date onOrBefore, same day", date("onOrBefore", "2020-01-01"), day("2020-01-01"), true],
  ["date onOrBefore, later", date("onOrBefore", "2020-01-01"), day("2020-01-02"), false],
  ["date after, later", date("after", "2020-01-01"), day("2020-01-02"), true],
  ["date after, same day", date("after", "2020-01-01"), day("2020-01-01"), false],
  ["date onOrAfter, same day", date("onOrAfter", "2020-01-01"), day("2020-01-01"), true],
  ["date onOrAfter, earlier", date("onOrAfter", "2020-01-01"), day("2019-12-31"), false],
  ["date between, at min", dateBetween("2020-01-01", "2020-12-31"), day("2020-01-01"), true],
  ["date between, at max", dateBetween("2020-01-01", "2020-12-31"), day("2020-12-31"), true],
  ["date between, after", dateBetween("2020-01-01", "2020-12-31"), day("2021-01-01"), false],
];

export const WRONG_TYPE_ANSWER: Record<Condition["type"], ClientAnswerValue> = {
  text: decimal("1"),
  single_choice: picks("a"),
  multiple_choice: pick("a"),
  number: textAnswer("18"),
  date: textAnswer("2020-01-01"),
};
