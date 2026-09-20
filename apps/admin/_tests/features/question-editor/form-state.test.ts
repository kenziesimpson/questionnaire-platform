import type { Option, QuestionVersion } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { questionInputFromForm } from "../../../src/features/question-editor/form-serialize";
import { formFromQuestion } from "../../../src/features/question-editor/form-state";

describe("formFromQuestion", () => {
  const choiceWith = (...options: Option[]): QuestionVersion => ({
    questionId: "01a0950f-4161-7719-98fb-afa43f4c6232",
    questionVersion: 2,
    createdAt: "2026-09-14T09:00:00.000Z",
    createdBy: null,
    type: "multiple_choice",
    prompt: "Which symptoms?",
    options,
  });
  const cough = { optionId: "opt_cough", label: "Cough" };

  it("turns the freeform other option into the Other toggle and its label", () => {
    const form = formFromQuestion(choiceWith(cough, { optionId: "other", label: "Something else", freeform: true }));

    expect(form).toMatchObject({ options: [cough], otherEnabled: true, otherLabel: "Something else" });
    expect(questionInputFromForm(form)).toMatchObject({
      options: [cough, { optionId: "other", label: "Something else", freeform: true }],
    });
  });
});
