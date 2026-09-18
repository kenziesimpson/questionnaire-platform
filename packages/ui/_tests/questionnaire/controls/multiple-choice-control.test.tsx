import type { ClientAnswers } from "@qp/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionnaireItems } from "../../../src/questionnaire";
import { aSymptomsItem, rendererProps } from "../../fixtures";
import { StatefulItems } from "../../stateful";

function renderSymptoms(overrides: Parameters<typeof rendererProps>[0] = {}, item = aSymptomsItem()) {
  render(<QuestionnaireItems visibleItems={[item]} {...rendererProps(overrides)} />);
  return {
    group: screen.getByRole("group", { name: /Which symptoms do you have\?/ }),
    box: (name: string) => screen.getByRole("checkbox", { name }),
    otherText: screen.getByRole("textbox", { name: "Other, please specify" }),
  };
}

const coughAndFever: ClientAnswers = { itm_05: { type: "multiple_choice", optionIds: ["opt_cough", "opt_fever"] } };

describe("multiple choice control", () => {
  it("is a group of checkboxes in a fieldset named by its legend", () => {
    const { group } = renderSymptoms();
    expect(group.tagName).toBe("FIELDSET");
    expect(group).toHaveAccessibleName("Which symptoms do you have?");
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("names a required group with the required marker read aloud", () => {
    const { group } = renderSymptoms({}, aSymptomsItem({ required: true }));
    expect(group).toHaveAccessibleName("Which symptoms do you have? (required)");
  });

  it("reports a first selection as a one-element optionIds keyed by itemId", async () => {
    const onChange = vi.fn();
    const { box } = renderSymptoms({ onChange });
    await userEvent.click(box("Fever"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_05", { type: "multiple_choice", optionIds: ["opt_fever"] });
  });

  it("adds to the selection in option order, whatever order they were clicked", async () => {
    const onChange = vi.fn();
    const { box } = renderSymptoms({ onChange, answers: { itm_05: { type: "multiple_choice", optionIds: ["opt_fever"] } } });
    await userEvent.click(box("Cough"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_05", { type: "multiple_choice", optionIds: ["opt_cough", "opt_fever"] });
  });

  it("removes an unchecked option", async () => {
    const onChange = vi.fn();
    const { box } = renderSymptoms({ onChange, answers: coughAndFever });
    await userEvent.click(box("Cough"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_05", { type: "multiple_choice", optionIds: ["opt_fever"] });
  });

  it("reports null when the last option is unchecked", async () => {
    const onChange = vi.fn();
    const { box } = renderSymptoms({ onChange, answers: { itm_05: { type: "multiple_choice", optionIds: ["opt_fever"] } } });
    await userEvent.click(box("Fever"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_05", null);
  });

  it("is controlled: it checks the answered options and changes nothing on its own", async () => {
    const { box } = renderSymptoms({ answers: coughAndFever });
    expect(box("Cough")).toBeChecked();
    expect(box("Fever")).toBeChecked();
    await userEvent.click(box("Cough"));
    expect(box("Cough")).toBeChecked();
  });
});

describe("multiple choice other option", () => {
  it("shows the text box beside the other checkbox before other is checked", () => {
    const { otherText, box } = renderSymptoms();
    expect(box("Other").parentElement).toContainElement(otherText);
  });

  it("checks other, keeping the existing selection, when the respondent types", () => {
    const onChange = vi.fn();
    const { otherText } = renderSymptoms({ onChange, answers: { itm_05: { type: "multiple_choice", optionIds: ["opt_cough"] } } });
    fireEvent.change(otherText, { target: { value: "Rash" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_05", {
      type: "multiple_choice",
      optionIds: ["opt_cough", "other"],
      otherText: "Rash",
    });
  });

  it("keeps other checked and drops otherText when the text box is cleared", () => {
    const onChange = vi.fn();
    const { otherText } = renderSymptoms({
      onChange,
      answers: { itm_05: { type: "multiple_choice", optionIds: ["other"], otherText: "Rash" } },
    });
    expect(otherText).toHaveValue("Rash");
    fireEvent.change(otherText, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_05", { type: "multiple_choice", optionIds: ["other"] });
  });

  it("keeps otherText while other stays checked and another option is toggled", async () => {
    const onChange = vi.fn();
    const { box } = renderSymptoms({ onChange, answers: { itm_05: { type: "multiple_choice", optionIds: ["other"], otherText: "Rash" } } });
    await userEvent.click(box("Fever"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_05", {
      type: "multiple_choice",
      optionIds: ["opt_fever", "other"],
      otherText: "Rash",
    });
  });

  it("omits otherText from the answer when other is unchecked", async () => {
    const onChange = vi.fn();
    const { box } = renderSymptoms({
      onChange,
      answers: { itm_05: { type: "multiple_choice", optionIds: ["opt_cough", "other"], otherText: "Rash" } },
    });
    await userEvent.click(box("Other"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_05", { type: "multiple_choice", optionIds: ["opt_cough"] });
  });

  it("keeps the text visible after other is unchecked, and restores otherText when it is checked again", async () => {
    const onAnswer = vi.fn();
    render(<StatefulItems items={[aSymptomsItem()]} onAnswer={onAnswer} />);
    const box = () => screen.getByRole("textbox", { name: "Other, please specify" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Cough" }));
    fireEvent.change(box(), { target: { value: "Rash" } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    expect(onAnswer).toHaveBeenLastCalledWith("itm_05", { type: "multiple_choice", optionIds: ["opt_cough"] });
    expect(box()).toHaveValue("Rash");
    await userEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    expect(onAnswer).toHaveBeenLastCalledWith("itm_05", { type: "multiple_choice", optionIds: ["opt_cough", "other"], otherText: "Rash" });
  });

  it("reports null when every option is unchecked and still keeps the text in the box", async () => {
    const onAnswer = vi.fn();
    render(<StatefulItems items={[aSymptomsItem()]} onAnswer={onAnswer} />);
    const box = () => screen.getByRole("textbox", { name: "Other, please specify" });
    fireEvent.change(box(), { target: { value: "Rash" } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    expect(onAnswer).toHaveBeenLastCalledWith("itm_05", null);
    expect(box()).toHaveValue("Rash");
    await userEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    expect(onAnswer).toHaveBeenLastCalledWith("itm_05", { type: "multiple_choice", optionIds: ["other"], otherText: "Rash" });
  });
});

describe("multiple choice readonly and error state", () => {
  it("disables the checkboxes, makes the text box read-only and reports nothing in readonly mode", async () => {
    const onChange = vi.fn();
    const { box, otherText } = renderSymptoms({ onChange, mode: "readonly", answers: coughAndFever });
    expect(box("Cough")).toBeDisabled();
    expect(otherText).toHaveAttribute("readonly");
    await userEvent.click(box("Other"));
    fireEvent.change(otherText, { target: { value: "Rash" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks the group invalid and describes it with the catalogue message", () => {
    const { group } = renderSymptoms({ errors: { itm_05: ["choice/too-many"] } });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription("Choose no more than 2 options.");
  });

  it("renders no text box for a freeform option whose id is not the other id (Decisions Log #82)", () => {
    const item = aSymptomsItem();
    if (item.question.type !== "multiple_choice") throw new Error("the symptoms fixture is no longer a multiple choice question");
    const options = item.question.options.map((option) => (option.freeform ? { ...option, optionId: "opt_else" } : option));
    render(<QuestionnaireItems visibleItems={[{ ...item, question: { ...item.question, options } }]} {...rendererProps()} />);
    expect(screen.getByRole("checkbox", { name: "Other" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
