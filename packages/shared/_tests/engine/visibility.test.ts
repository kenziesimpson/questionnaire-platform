import { describe, expect, it } from "vitest";
import type { ClientAnswers, ClientAnswerValue } from "../../src/domain/answer.js";
import type { Condition } from "../../src/domain/condition.js";
import { intakeDefinition } from "../../src/demo/intake.js";
import { evaluateVisibility, visibleAnswers, visibleItems } from "../../src/engine/visibility.js";
import { aDefinition, all, anItem, any, questions } from "./fixtures.js";
import { conditions, day, OPERATOR_CASES, pick, textAnswer } from "./operator-table.js";

const GATE_OPEN: ClientAnswerValue = pick("yes");
const GATE_CLOSED: ClientAnswerValue = pick("no");
const behindGate = { visibleWhen: all({ type: "single_choice", itemId: "gate", op: "is", optionId: "yes" }) };

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

describe("evaluateVisibility — traversal feeds each condition what was shown", () => {
  it.each(OPERATOR_CASES)("referenced item shown by its gate: %s → %s", (_, condition, answer, expected) => {
    expect(targetShown(condition, answer)).toBe(expected);
  });

  it.each(OPERATOR_CASES)("referenced item hidden by its gate, stale answer kept: %s → false", (_, condition, answer) => {
    expect(targetShown(condition, answer, GATE_CLOSED)).toBe(false);
  });

  it("text notAnswered follows the referenced item's gate", () => {
    expect(targetShown(conditions.text("notAnswered"), null)).toBe(true);
    expect(targetShown(conditions.text("notAnswered"), null, GATE_CLOSED)).toBe(false);
  });

  it("treats an explicit null and an absent key identically", () => {
    const definition = definitionFor(conditions.single("isNot", "a"));
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
