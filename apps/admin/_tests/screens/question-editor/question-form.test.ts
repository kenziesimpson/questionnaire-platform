import { validateQuestionRules } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { blankForm, edits, questionInputOf, type QuestionForm } from "../../../src/screens/question-editor/question-form";

const withType = (patch: Partial<QuestionForm>): QuestionForm => ({ ...blankForm(), prompt: "PR2 Prompt", ...patch });

describe("questionInputOf", () => {
  it.each<[string, Partial<QuestionForm>]>([
    ["a max length still below the min length", { type: "text", minLength: "20", maxLength: "4" }],
    ["a number max still below the min", { type: "number", numberMin: "10", numberMax: "2" }],
    ["a latest date still before the earliest", { type: "date", dateMin: "2026-06-01", dateMax: "2026-01-01" }],
    [
      "selection bounds past the option count and inverted",
      { type: "multiple_choice", minSelections: "3", maxSelections: "1", options: [{ optionId: "opt_a", label: "A" }] },
    ],
  ])("never serializes %s, even when the field has not been left yet", (_, patch) => {
    expect(validateQuestionRules(questionInputOf(withType(patch)))).toEqual([]);
  });

  it("leaves empty constraint fields out and keeps the chosen type's fields only", () => {
    expect(questionInputOf(withType({ type: "number", numberKind: "float", unit: " kg ", minLength: "3" }))).toEqual({
      type: "number",
      prompt: "PR2 Prompt",
      numberKind: "float",
      unit: "kg",
    });
    expect(JSON.parse(JSON.stringify(questionInputOf(withType({ type: "date", relative: "any" }))))).toEqual({
      type: "date",
      prompt: "PR2 Prompt",
    });
  });

  it("builds a yes / no question from exactly the two reserved options, whatever Other state the form carries", () => {
    const yesNo = edits.yesNo(withType({ type: "single_choice", otherEnabled: true }), true);

    expect(questionInputOf({ ...yesNo, otherEnabled: true })).toEqual({
      type: "single_choice",
      prompt: "PR2 Prompt",
      options: [
        { optionId: "yes", label: "Yes" },
        { optionId: "no", label: "No" },
      ],
    });
  });
});
