import { describe, expect, it } from "vitest";
import type { QuestionInput } from "../../src/domain/question.js";
import { validateQuestionRules } from "../../src/engine/question-rules.js";
import { QUESTION_RULE_CODES } from "../../src/problems.js";
import { questions } from "./fixtures.js";

describe("validateQuestionRules — cross-field rules a schema cannot express", () => {
  it.each<[string, QuestionInput, { pointer: string; code: string }[]]>([
    ["the yes/no template", questions.yesNo(), []],
    ["text minLength above maxLength", questions.text({ minLength: 10, maxLength: 5 }), [{ pointer: "/minLength", code: "question/min-length-exceeds-max-length" }]],
    ["text minLength equal to maxLength", questions.text({ minLength: 5, maxLength: 5 }), []],
    ["number min above max", questions.number({ min: 10, max: 1 }), [{ pointer: "/min", code: "question/min-exceeds-max" }]],
    ["date min after max", questions.date({ min: "2026-01-02", max: "2026-01-01" }), [{ pointer: "/min", code: "question/min-exceeds-max" }]],
    [
      "minSelections above maxSelections",
      questions.multiple({ minSelections: 3, maxSelections: 2 }),
      [{ pointer: "/minSelections", code: "question/min-selections-exceeds-max-selections" }],
    ],
    [
      "minSelections above the option count",
      questions.multiple({ minSelections: 5, optionIds: ["a", "b"] }),
      [{ pointer: "/minSelections", code: "question/selections-exceed-options" }],
    ],
    [
      "maxSelections above the option count",
      questions.multiple({ maxSelections: 3, optionIds: ["a", "b"] }),
      [{ pointer: "/maxSelections", code: "question/selections-exceed-options" }],
    ],
    [
      "a repeated option id",
      { type: "single_choice", prompt: "x", options: [{ optionId: "a", label: "A" }, { optionId: "a", label: "A again" }] },
      [{ pointer: "/options/1/optionId", code: "question/duplicate-option-id" }],
    ],
    [
      "a freeform option not named other",
      { type: "multiple_choice", prompt: "x", options: [{ optionId: "a", label: "A", freeform: true }] },
      [{ pointer: "/options/0/freeform", code: "question/freeform-not-other" }],
    ],
    [
      "an option named other that is not freeform",
      { type: "single_choice", prompt: "x", options: [{ optionId: "a", label: "A" }, { optionId: "other", label: "None of these" }] },
      [{ pointer: "/options/1/optionId", code: "question/other-not-freeform" }],
    ],
    [
      "an option named other with freeform false",
      { type: "multiple_choice", prompt: "x", options: [{ optionId: "other", label: "Other", freeform: false }] },
      [{ pointer: "/options/0/optionId", code: "question/other-not-freeform" }],
    ],
    [
      "a plain other beside the freeform other",
      {
        type: "multiple_choice",
        prompt: "x",
        options: [{ optionId: "other", label: "Other", freeform: true }, { optionId: "other", label: "None of these" }],
      },
      [
        { pointer: "/options/1/optionId", code: "question/duplicate-option-id" },
        { pointer: "/options/1/optionId", code: "question/other-not-freeform" },
      ],
    ],
    ["a freeform other", questions.single(), []],
  ])("%s", (_, question, expected) => {
    const errors = validateQuestionRules(question);
    expect(errors).toEqual(expected);
    for (const error of errors) expect(QUESTION_RULE_CODES).toContain(error.code);
  });
});
