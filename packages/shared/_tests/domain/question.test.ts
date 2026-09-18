import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { intakeDefinition } from "../../src/demo/intake.js";
import {
  OTHER_OPTION_ID,
  QuestionInput,
  RESPONSE_TYPES,
  freeformOptionOf,
  isChoiceQuestion,
  optionIdsOf,
  questionInputOf,
  type Option,
} from "../../src/domain/question.js";
import { questions } from "../engine/fixtures.js";

const choiceWith = (...options: Option[]): QuestionInput => ({ type: "single_choice", prompt: "Pick one", options });

describe("the other option", () => {
  it("is the option whose id is OTHER_OPTION_ID and that is freeform, in either choice type", () => {
    const other = { optionId: OTHER_OPTION_ID, label: "Something else", freeform: true };
    expect(freeformOptionOf(choiceWith({ optionId: "a", label: "A" }, other))).toEqual(other);
    expect(freeformOptionOf(questions.multiple())).toEqual({ optionId: OTHER_OPTION_ID, label: "OTHER", freeform: true });
  });

  it.each<[string, Option]>([
    ["an option with the other id that is not freeform", { optionId: OTHER_OPTION_ID, label: "Other" }],
    ["an option with the other id and freeform false", { optionId: OTHER_OPTION_ID, label: "Other", freeform: false }],
    ["a freeform option with another id", { optionId: "opt_else", label: "Else", freeform: true }],
  ])("is not %s", (_, option) => {
    expect(freeformOptionOf(choiceWith({ optionId: "a", label: "A" }, option))).toBeUndefined();
  });

  it("does not exist on a question without options", () => {
    expect(freeformOptionOf(questions.text())).toBeUndefined();
    expect(freeformOptionOf(questions.number())).toBeUndefined();
  });
});

describe("choice questions", () => {
  it("are exactly single_choice and multiple_choice", () => {
    expect(RESPONSE_TYPES.filter((type) => isChoiceQuestion({ type }))).toEqual(["single_choice", "multiple_choice"]);
  });

  it("list their option ids in authored order, and a question without options lists none", () => {
    expect(optionIdsOf(questions.single())).toEqual(["a", "b", "c", OTHER_OPTION_ID]);
    expect(optionIdsOf(questions.date())).toEqual([]);
  });
});

describe("questionInputOf", () => {
  it("strips a pinned question's identity and keeps its content, so a save request of it validates", () => {
    for (const { question } of intakeDefinition(2).items) {
      const input = questionInputOf(question);
      expect(input).toEqual({ ...question, questionId: undefined, questionVersion: undefined });
      expect(Object.keys(input)).not.toContain("questionId");
      expect(Value.Check(QuestionInput, input)).toBe(true);
    }
  });
});
