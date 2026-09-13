import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionnaireItems } from "../../../src/questionnaire";
import { hasCondition, rendererProps, whichCondition } from "../../fixtures";
import { StatefulItems } from "../../stateful";

function renderChoice(overrides: Parameters<typeof rendererProps>[0] = {}, item = whichCondition) {
  const props = rendererProps(overrides);
  render(<QuestionnaireItems visibleItems={[item]} {...props} />);
  return {
    group: screen.getByRole("radiogroup"),
    radio: (name: string) => screen.getByRole("radio", { name }),
    otherText: screen.queryByRole("textbox", { name: "Other, please specify" }),
  };
}

describe("single choice control", () => {
  it("is a radio group rendered as a fieldset named by its legend", () => {
    const { group } = renderChoice();
    expect(group.tagName).toBe("FIELDSET");
    expect(group).toHaveAccessibleName("Which condition? (required)");
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
  });

  it("names each radio by its option label", () => {
    const { radio } = renderChoice();
    expect(radio("Diabetes")).toBeInTheDocument();
    expect(radio("Hypertension")).toBeInTheDocument();
    expect(radio("Other")).toBeInTheDocument();
  });

  it("reports the chosen option id keyed by itemId", async () => {
    const onChange = vi.fn();
    const { radio } = renderChoice({ onChange });
    await userEvent.click(radio("Hypertension"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_02", { type: "single_choice", optionId: "opt_hyperten" });
  });

  it("is controlled: it checks the answered option and does not move on its own", async () => {
    const { radio } = renderChoice({ answers: { itm_02: { type: "single_choice", optionId: "opt_diabetes" } } });
    expect(radio("Diabetes")).toBeChecked();
    await userEvent.click(radio("Hypertension"));
    expect(radio("Diabetes")).toBeChecked();
    expect(radio("Hypertension")).not.toBeChecked();
  });

  it("reports nothing when the already chosen option is chosen again", async () => {
    const onChange = vi.fn();
    const { radio } = renderChoice({ onChange, answers: { itm_02: { type: "single_choice", optionId: "opt_diabetes" } } });
    await userEvent.click(radio("Diabetes"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders no text box for a question without a freeform option", () => {
    const { otherText } = renderChoice({}, hasCondition);
    expect(otherText).toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("single choice other option", () => {
  it("shows the text box beside the other radio before other is chosen", () => {
    const { otherText, radio } = renderChoice();
    expect(otherText).toBeInTheDocument();
    expect(radio("Other").parentElement).toContainElement(otherText);
  });

  it("selects other when the respondent types into the text box", () => {
    const onChange = vi.fn();
    const { otherText } = renderChoice({ onChange });
    fireEvent.change(otherText!, { target: { value: "Asthma" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_02", { type: "single_choice", optionId: "other", otherText: "Asthma" });
  });

  it("keeps other selected and drops otherText when the text box is cleared", () => {
    const onChange = vi.fn();
    const { otherText } = renderChoice({ onChange, answers: { itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" } } });
    expect(otherText).toHaveValue("Asthma");
    fireEvent.change(otherText!, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_02", { type: "single_choice", optionId: "other" });
  });

  it("passes whitespace through unchanged, leaving blank other text to the validator", () => {
    const onChange = vi.fn();
    const { otherText } = renderChoice({ onChange });
    fireEvent.change(otherText!, { target: { value: "  " } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_02", { type: "single_choice", optionId: "other", otherText: "  " });
  });

  it("omits otherText from the answer when a different option is chosen", async () => {
    const onChange = vi.fn();
    const { radio } = renderChoice({ onChange, answers: { itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" } } });
    await userEvent.click(radio("Diabetes"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_02", { type: "single_choice", optionId: "opt_diabetes" });
  });

  it("seeds the text box from the answer's otherText", () => {
    const { otherText } = renderChoice({ answers: { itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" } } });
    expect(otherText).toHaveValue("Asthma");
  });

  it("keeps the typed text visible after switching to a different option", async () => {
    const onAnswer = vi.fn();
    render(<StatefulItems items={[whichCondition]} onAnswer={onAnswer} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Other, please specify" }), { target: { value: "Asthma" } });
    await userEvent.click(screen.getByRole("radio", { name: "Diabetes" }));
    expect(onAnswer).toHaveBeenLastCalledWith("itm_02", { type: "single_choice", optionId: "opt_diabetes" });
    expect(screen.getByRole("radio", { name: "Diabetes" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Other, please specify" })).toHaveValue("Asthma");
  });

  it("puts the retained text back into the answer when other is chosen again", async () => {
    const onAnswer = vi.fn();
    render(<StatefulItems items={[whichCondition]} onAnswer={onAnswer} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Other, please specify" }), { target: { value: "Asthma" } });
    await userEvent.click(screen.getByRole("radio", { name: "Diabetes" }));
    await userEvent.click(screen.getByRole("radio", { name: "Other" }));
    expect(onAnswer).toHaveBeenLastCalledWith("itm_02", { type: "single_choice", optionId: "other", otherText: "Asthma" });
    expect(screen.getByRole("textbox", { name: "Other, please specify" })).toHaveValue("Asthma");
  });

  it("follows a cleared text box while other stays selected, so reselecting later carries no stale text", async () => {
    const onAnswer = vi.fn();
    render(<StatefulItems items={[whichCondition]} onAnswer={onAnswer} />);
    const box = () => screen.getByRole("textbox", { name: "Other, please specify" });
    fireEvent.change(box(), { target: { value: "Asthma" } });
    fireEvent.change(box(), { target: { value: "" } });
    await userEvent.click(screen.getByRole("radio", { name: "Diabetes" }));
    await userEvent.click(screen.getByRole("radio", { name: "Other" }));
    expect(onAnswer).toHaveBeenLastCalledWith("itm_02", { type: "single_choice", optionId: "other" });
    expect(box()).toHaveValue("");
  });
});

describe("single choice readonly and error state", () => {
  it("disables the radios, makes the text box read-only and reports nothing in readonly mode", async () => {
    const onChange = vi.fn();
    const { radio, otherText } = renderChoice({
      onChange,
      mode: "readonly",
      answers: { itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" } },
    });
    expect(radio("Other")).toBeChecked();
    expect(radio("Diabetes")).toBeDisabled();
    expect(otherText).toHaveAttribute("readonly");
    await userEvent.click(radio("Diabetes"));
    fireEvent.change(otherText!, { target: { value: "Gout" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks the group invalid and describes it with the catalogue message", () => {
    const { group } = renderChoice({ errors: { itm_02: ["choice/other-text-required"] } });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription('Enter your answer for "Other".');
  });

  it("carries neither attribute without an error", () => {
    const { group } = renderChoice();
    expect(group).not.toHaveAttribute("aria-invalid");
    expect(group).not.toHaveAttribute("aria-describedby");
  });
});
