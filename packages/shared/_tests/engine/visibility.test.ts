import { describe, expect, it } from "vitest";
import type { ClientAnswers, ClientAnswerValue } from "../../src/domain/answer.js";
import type { Condition } from "../../src/domain/condition.js";
import { intakeDefinition } from "../../src/demo/intake.js";
import { evaluateVisibility, visibleAnswers, visibleItems } from "../../src/engine/visibility.js";
import { aDefinition, all, anItem, any, questions } from "./fixtures.js";

const GATE_OPEN: ClientAnswerValue = { type: "single_choice", optionId: "yes" };
const GATE_CLOSED: ClientAnswerValue = { type: "single_choice", optionId: "no" };
const behindGate = { visibleWhen: all({ type: "single_choice", itemId: "gate", op: "is", optionId: "yes" }) };

const SOURCE_BY_TYPE = { text: "src_text", single_choice: "src_single", multiple_choice: "src_multi", number: "src_number", date: "src_date" } as const;

function definitionFor(condition: Condition) {
  return aDefinition([
    anItem("gate", questions.yesNo()),
    anItem("src_text", questions.text(), behindGate),
    anItem("src_single", questions.single(), behindGate),
    anItem("src_multi", questions.multiple(), behindGate),
    anItem("src_number", questions.number(), behindGate),
    anItem("src_date", questions.date(), behindGate),
    anItem("target", questions.text(), { visibleWhen: all(condition) }),
  ]);
}

function targetShown(condition: Condition, answer: ClientAnswerValue | null, gate = GATE_OPEN): boolean {
  const answers: ClientAnswers = { gate, [condition.itemId]: answer };
  return evaluateVisibility(definitionFor(condition), answers).has("target");
}

const text = (op: "answered" | "notAnswered"): Condition => ({ type: "text", itemId: "src_text", op });
const single = (op: "is" | "isNot", optionId: string): Condition => ({ type: "single_choice", itemId: "src_single", op, optionId });
const singleList = (op: "isAnyOf" | "isNoneOf", optionIds: string[]): Condition => ({ type: "single_choice", itemId: "src_single", op, optionIds });
const multi = (op: "includes" | "excludes", optionId: string): Condition => ({ type: "multiple_choice", itemId: "src_multi", op, optionId });
const multiList = (op: "includesAnyOf" | "includesAllOf", optionIds: string[]): Condition => ({ type: "multiple_choice", itemId: "src_multi", op, optionIds });
const num = (op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte", value: number): Condition => ({ type: "number", itemId: "src_number", op, value });
const date = (op: "before" | "onOrBefore" | "after" | "onOrAfter", on: string): Condition => ({ type: "date", itemId: "src_date", op, date: on });

const textAnswer = (value: string): ClientAnswerValue => ({ type: "text", text: value });
const pick = (optionId: string): ClientAnswerValue => ({ type: "single_choice", optionId });
const picks = (...optionIds: string[]): ClientAnswerValue => ({ type: "multiple_choice", optionIds });
const decimal = (value: string): ClientAnswerValue => ({ type: "number", value });
const day = (value: string): ClientAnswerValue => ({ type: "date", date: value });

const OPERATOR_TABLE: [string, Condition, ClientAnswerValue, boolean][] = [
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
  ["date before, earlier", date("before", "2020-01-01"), day("2019-12-31"), true],
  ["date before, same day", date("before", "2020-01-01"), day("2020-01-01"), false],
  ["date onOrBefore, same day", date("onOrBefore", "2020-01-01"), day("2020-01-01"), true],
  ["date onOrBefore, later", date("onOrBefore", "2020-01-01"), day("2020-01-02"), false],
  ["date after, later", date("after", "2020-01-01"), day("2020-01-02"), true],
  ["date after, same day", date("after", "2020-01-01"), day("2020-01-01"), false],
  ["date onOrAfter, same day", date("onOrAfter", "2020-01-01"), day("2020-01-01"), true],
  ["date onOrAfter, earlier", date("onOrAfter", "2020-01-01"), day("2019-12-31"), false],
];

const BETWEEN_TABLE: [string, Condition, ClientAnswerValue, boolean][] = [
  ["number between, at min", { type: "number", itemId: "src_number", op: "between", min: 1.5, max: 2.5 }, decimal("1.5"), true],
  ["number between, at max", { type: "number", itemId: "src_number", op: "between", min: 1.5, max: 2.5 }, decimal("2.50"), true],
  ["number between, above", { type: "number", itemId: "src_number", op: "between", min: 1.5, max: 2.5 }, decimal("2.51"), false],
  ["number between, below", { type: "number", itemId: "src_number", op: "between", min: 1.5, max: 2.5 }, decimal("1.49"), false],
  ["date between, at min", { type: "date", itemId: "src_date", op: "between", min: "2020-01-01", max: "2020-12-31" }, day("2020-01-01"), true],
  ["date between, at max", { type: "date", itemId: "src_date", op: "between", min: "2020-01-01", max: "2020-12-31" }, day("2020-12-31"), true],
  ["date between, after", { type: "date", itemId: "src_date", op: "between", min: "2020-01-01", max: "2020-12-31" }, day("2021-01-01"), false],
];

const ALL_CASES = [...OPERATOR_TABLE, ...BETWEEN_TABLE];

const WRONG_TYPE_ANSWER: Record<Condition["type"], ClientAnswerValue> = {
  text: decimal("1"),
  single_choice: picks("a"),
  multiple_choice: pick("a"),
  number: textAnswer("18"),
  date: textAnswer("2020-01-01"),
};

describe("evaluateVisibility — every operator against every type", () => {
  it("covers every operator of every response type", () => {
    const covered = new Set(ALL_CASES.map(([, condition]) => `${condition.type}.${condition.op}`));
    expect([...covered].sort()).toEqual(
      [
        "text.answered", "text.notAnswered",
        "single_choice.is", "single_choice.isNot", "single_choice.isAnyOf", "single_choice.isNoneOf",
        "multiple_choice.includes", "multiple_choice.excludes", "multiple_choice.includesAnyOf", "multiple_choice.includesAllOf",
        "number.eq", "number.neq", "number.lt", "number.lte", "number.gt", "number.gte", "number.between",
        "date.before", "date.onOrBefore", "date.after", "date.onOrAfter", "date.between",
      ].sort(),
    );
  });

  it.each(ALL_CASES)("%s → %s", (_, condition, answer, expected) => {
    expect(SOURCE_BY_TYPE[condition.type]).toBe(condition.itemId);
    expect(targetShown(condition, answer)).toBe(expected);
  });
});

describe("evaluateVisibility — a condition on a question that was not answered or not shown is false", () => {
  const exceptNotAnswered = ALL_CASES.filter(([, condition]) => condition.op !== "notAnswered");

  it.each(exceptNotAnswered)("unanswered: %s → false", (_, condition) => {
    expect(targetShown(condition, null)).toBe(false);
  });

  it.each(ALL_CASES)("referenced item hidden, stale answer kept: %s → false", (_, condition, answer) => {
    expect(targetShown(condition, answer, GATE_CLOSED)).toBe(false);
  });

  it.each(ALL_CASES)("answer shaped for another type: %s → false", (_, condition) => {
    expect(targetShown(condition, WRONG_TYPE_ANSWER[condition.type])).toBe(false);
  });

  it("negative operators do not fire for a respondent who never answered (the SQL NULL trap)", () => {
    for (const condition of [single("isNot", "a"), singleList("isNoneOf", ["a"]), multi("excludes", "a"), num("neq", 1)]) {
      expect(targetShown(condition, null)).toBe(false);
    }
  });

  it("text notAnswered is true only while the referenced item is shown and unanswered", () => {
    expect(targetShown(text("notAnswered"), null)).toBe(true);
    expect(targetShown(text("notAnswered"), null, GATE_CLOSED)).toBe(false);
    expect(targetShown(text("notAnswered"), textAnswer("x"))).toBe(false);
  });

  it("treats an explicit null and an absent key identically", () => {
    const definition = definitionFor(single("isNot", "a"));
    expect(evaluateVisibility(definition, { gate: GATE_OPEN, src_single: null })).toEqual(
      evaluateVisibility(definition, { gate: GATE_OPEN }),
    );
  });

  it("does not read inherited properties as answers when an itemId shares a name with Object.prototype", () => {
    const definition = aDefinition([
      anItem("constructor", questions.text()),
      anItem("target", questions.text(), { visibleWhen: all({ type: "text", itemId: "constructor", op: "answered" }) }),
    ]);
    expect(evaluateVisibility(definition, {}).has("target")).toBe(false);
  });

  it("evaluates a reference to a later item as not shown", () => {
    const definition = aDefinition([
      anItem("first", questions.text(), { visibleWhen: all({ type: "text", itemId: "second", op: "answered" }) }),
      anItem("second", questions.text()),
    ]);
    expect([...evaluateVisibility(definition, { second: textAnswer("x") })]).toEqual(["second"]);
  });
});

describe("evaluateVisibility — all / any grouping", () => {
  const definition = aDefinition([
    anItem("p", questions.yesNo()),
    anItem("q", questions.yesNo()),
    anItem("both", questions.text(), {
      visibleWhen: all({ type: "single_choice", itemId: "p", op: "is", optionId: "yes" }, { type: "single_choice", itemId: "q", op: "is", optionId: "yes" }),
    }),
    anItem("either", questions.text(), {
      visibleWhen: any({ type: "single_choice", itemId: "p", op: "is", optionId: "yes" }, { type: "single_choice", itemId: "q", op: "is", optionId: "yes" }),
    }),
    anItem("all_of_one", questions.text(), { visibleWhen: all({ type: "single_choice", itemId: "p", op: "is", optionId: "yes" }) }),
    anItem("any_of_one", questions.text(), { visibleWhen: any({ type: "single_choice", itemId: "p", op: "is", optionId: "yes" }) }),
    anItem("all_empty", questions.text(), { visibleWhen: { all: [] } }),
    anItem("any_empty", questions.text(), { visibleWhen: { any: [] } }),
  ]);

  const answer = (value: "yes" | "no" | null): ClientAnswerValue | null => (value === null ? null : pick(value));

  it.each<["yes" | "no" | null, "yes" | "no" | null, boolean, boolean, boolean]>([
    ["yes", "yes", true, true, true],
    ["yes", "no", false, true, true],
    ["no", "yes", false, true, false],
    ["no", "no", false, false, false],
    [null, "yes", false, true, false],
    ["yes", null, false, true, true],
    [null, null, false, false, false],
  ])("p=%s q=%s → all %s, any %s, single-condition %s", (p, q, both, either, single) => {
    const shown = evaluateVisibility(definition, { p: answer(p), q: answer(q) });
    expect(shown.has("both")).toBe(both);
    expect(shown.has("either")).toBe(either);
    expect(shown.has("all_of_one")).toBe(single);
    expect(shown.has("any_of_one")).toBe(single);
  });

  it("an empty all is true and an empty any is false", () => {
    const shown = evaluateVisibility(definition, {});
    expect(shown.has("all_empty")).toBe(true);
    expect(shown.has("any_empty")).toBe(false);
  });
});

describe("the mandatory branching demo — truth table", () => {
  const cases: [string, ClientAnswers, string[]][] = [
    ["yes → condition and diagnosis date, then pharmacy", { itm_01: pick("yes") }, ["itm_01", "itm_02", "itm_03", "itm_04"]],
    ["no → skips both, converges on pharmacy", { itm_01: pick("no") }, ["itm_01", "itm_04"]],
    ["unanswered → the branch stays closed", {}, ["itm_01", "itm_04"]],
    [
      "no with stale branch answers kept in storage → still skipped",
      { itm_01: pick("no"), itm_02: pick("opt_diabetes"), itm_03: day("2019-04-02") },
      ["itm_01", "itm_04"],
    ],
  ];

  it.each([1, 2] as const)("version %s", (version) => {
    for (const [, answers, expected] of cases) {
      expect(visibleItems(intakeDefinition(version), answers).map((item) => item.itemId)).toEqual(expected);
    }
  });

  it("supports a rule over several earlier answers: has a condition AND it is diabetes", () => {
    const base = intakeDefinition(1);
    const definition = aDefinition([
      ...base.items,
      anItem("itm_05", questions.text(), {
        visibleWhen: all(
          { type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" },
          { type: "single_choice", itemId: "itm_02", op: "is", optionId: "opt_diabetes" },
        ),
      }),
    ]);
    const shownFor = (answers: ClientAnswers) => evaluateVisibility(definition, answers).has("itm_05");
    expect(shownFor({ itm_01: pick("yes"), itm_02: pick("opt_diabetes") })).toBe(true);
    expect(shownFor({ itm_01: pick("yes"), itm_02: pick("opt_hyperten") })).toBe(false);
    expect(shownFor({ itm_01: pick("no"), itm_02: pick("opt_diabetes") })).toBe(false);
    expect(shownFor({ itm_01: pick("yes") })).toBe(false);
  });
});

describe("visibleAnswers — the client's submit-time filter", () => {
  const definition = aDefinition([
    ...intakeDefinition(1).items,
    anItem("itm_05", questions.text(), { visibleWhen: all({ type: "single_choice", itemId: "itm_02", op: "is", optionId: "opt_diabetes" }) }),
  ]);
  const answers: ClientAnswers = {
    itm_01: pick("no"),
    itm_02: pick("opt_diabetes"),
    itm_03: day("2019-04-02"),
    itm_04: null,
    itm_05: textAnswer("Metformin"),
  };

  it("drops answers to hidden items and nulls, including a hidden item's dependants", () => {
    expect(visibleAnswers(definition, answers)).toEqual({ itm_01: pick("no") });
  });

  it("does not change the visible set, so the server re-evaluating the filtered payload agrees with the client", () => {
    expect(evaluateVisibility(definition, visibleAnswers(definition, answers))).toEqual(evaluateVisibility(definition, answers));
  });
});
