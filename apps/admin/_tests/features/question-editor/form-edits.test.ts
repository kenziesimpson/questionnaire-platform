import { describe, expect, it } from "vitest";
import { edits } from "../../../src/features/question-editor/form-edits";
import { blankForm, type QuestionForm } from "../../../src/features/question-editor/form-state";

const withType = (patch: Partial<QuestionForm>): QuestionForm => ({ ...blankForm(), prompt: "PR6 Prompt", ...patch });

describe("edits — cross-field clamping", () => {
  it("text: raising the min length above the max drags the max up, and a max typed below the min is clamped to it on commit", () => {
    let form = withType({ type: "text", maxLength: "5" });
    form = edits.minLength(form, "12");
    expect(form.maxLength).toBe("12");

    form = { ...form, maxLength: "3" };
    form = edits.commitMaxLength(form);
    expect(form.maxLength).toBe("12");
  });

  it("number: the max never stays below the min", () => {
    let form = withType({ type: "number", numberMax: "10" });
    form = edits.numberMin(form, "25.5");
    expect(form.numberMax).toBe("25.5");

    form = { ...form, numberMax: "-4" };
    form = edits.commitNumberMax(form);
    expect(form.numberMax).toBe("25.5");
  });

  it("date: an earliest after the latest moves the latest, and a latest before the earliest is clamped to it on commit", () => {
    let form = withType({ type: "date", dateMax: "2026-03-01" });
    form = edits.dateMin(form, "2026-06-01");
    expect(form.dateMax).toBe("2026-06-01");

    form = { ...form, dateMax: "2026-01-01" };
    form = edits.commitDateMax(form);
    expect(form.dateMax).toBe("2026-06-01");
  });

  it("multiple choice: min selections above max drags max up, both are capped by the option count, and removing an option lowers them", () => {
    let form = withType({
      type: "multiple_choice",
      options: [
        { optionId: "opt_a", label: "" },
        { optionId: "opt_b", label: "" },
        { optionId: "opt_c", label: "" },
      ],
      maxSelections: "1",
    });

    form = edits.minSelections(form, "2");
    expect(form.maxSelections).toBe("2");

    form = edits.minSelections(form, "9");
    expect(form.minSelections).toBe("3");
    form = edits.maxSelections(form, "7");
    expect(form.maxSelections).toBe("3");

    form = edits.options(form, form.options.slice(1));
    expect(form.minSelections).toBe("2");
    expect(form.maxSelections).toBe("2");
  });
});
