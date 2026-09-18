import { Value } from "typebox/value";
import { Condition, OPERATORS_BY_TYPE, RESPONSE_TYPES, type QuestionVersion } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { defaultConditionFor, isComplete, withOperator } from "../../../src/screens/draft-editor/conditions";
import { uuid, aQuestionVersion } from "../../support/builders";

const questions: Record<QuestionVersion["type"], QuestionVersion> = {
  text: aQuestionVersion({ type: "text", questionId: uuid(1), questionVersion: 1 }),
  single_choice: aQuestionVersion({ type: "single_choice", questionId: uuid(2), questionVersion: 1 }),
  multiple_choice: aQuestionVersion({ type: "multiple_choice", questionId: uuid(3), questionVersion: 1 }),
  number: aQuestionVersion({ type: "number", questionId: uuid(4), questionVersion: 1, min: 18 }),
  date: aQuestionVersion({ type: "date", questionId: uuid(5), questionVersion: 1, max: "2026-09-01" }),
};

describe("predicate conditions", () => {
  it("builds a default condition for every type with bounds, and every operator switch of it, that the shared Condition schema accepts", () => {
    for (const type of RESPONSE_TYPES) {
      const initial = defaultConditionFor("itm_01", questions[type]);
      expect(isComplete(initial)).toBe(true);
      expect(Value.Check(Condition, initial)).toBe(true);
      for (const op of OPERATORS_BY_TYPE[type]) {
        const switched = withOperator(initial, op);
        expect(switched.op).toBe(op);
        expect(Value.Check(Condition, switched)).toBe(true);
        expect(Value.Check(Condition, withOperator(switched, OPERATORS_BY_TYPE[type][0] ?? op))).toBe(true);
      }
    }
    expect(defaultConditionFor("itm_01", questions.number)).toMatchObject({ op: "eq", value: 18 });
    expect(defaultConditionFor("itm_01", questions.date)).toMatchObject({ op: "onOrAfter", date: "2026-09-01" });
  });

  it("defaults a number or date operand to the question's min, else its max, and never invents one for an unbounded question", () => {
    const onlyMax = aQuestionVersion({ type: "number", questionId: uuid(6), questionVersion: 1, max: 40 });
    expect(defaultConditionFor("itm_01", onlyMax)).toMatchObject({ value: 40 });

    const unboundedNumber = defaultConditionFor("itm_01", aQuestionVersion({ type: "number", questionId: uuid(7), questionVersion: 1 }));
    expect(unboundedNumber).toMatchObject({ type: "number", op: "eq" });
    expect("value" in unboundedNumber && Number.isNaN(unboundedNumber.value)).toBe(true);
    expect(isComplete(unboundedNumber)).toBe(false);
    expect(isComplete(withOperator(unboundedNumber, "between"))).toBe(false);

    const unboundedDate = defaultConditionFor("itm_01", aQuestionVersion({ type: "date", questionId: uuid(8), questionVersion: 1 }));
    expect(unboundedDate).toEqual({ type: "date", itemId: "itm_01", op: "onOrAfter", date: "" });
    expect(isComplete(unboundedDate)).toBe(false);
    expect(isComplete({ type: "date", itemId: "itm_01", op: "between", min: "2026-01-01", max: "" })).toBe(false);
    expect(isComplete({ type: "number", itemId: "itm_01", op: "between", min: 1, max: 2 })).toBe(true);
  });

  it("keeps operands across a switch between one and many options, and between a point and a range", () => {
    expect(withOperator({ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }, "isNoneOf")).toEqual({
      type: "single_choice",
      itemId: "itm_01",
      op: "isNoneOf",
      optionIds: ["yes"],
    });
    expect(withOperator({ type: "number", itemId: "itm_01", op: "between", min: 3, max: 9 }, "lt")).toEqual({
      type: "number",
      itemId: "itm_01",
      op: "lt",
      value: 3,
    });
    expect(withOperator({ type: "date", itemId: "itm_01", op: "after", date: "2026-01-01" }, "between")).toEqual({
      type: "date",
      itemId: "itm_01",
      op: "between",
      min: "2026-01-01",
      max: "2026-01-01",
    });
  });
});
