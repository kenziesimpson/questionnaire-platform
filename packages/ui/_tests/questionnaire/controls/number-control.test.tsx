import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionnaireItems } from "../../../src/questionnaire";
import { aNumberItem, rendererProps } from "../../fixtures";

const PROMPT = "What is your weight?";

function renderNumber(overrides: Parameters<typeof rendererProps>[0] = {}, item = aNumberItem()) {
  render(<QuestionnaireItems visibleItems={[item]} {...rendererProps(overrides)} />);
  return screen.getByRole("textbox", { name: PROMPT });
}

describe("number control", () => {
  it("is a text input, not type=number, named by the prompt", () => {
    expect(renderNumber()).toHaveAttribute("type", "text");
  });

  it("asks for a decimal keypad for a float question", () => {
    expect(renderNumber()).toHaveAttribute("inputmode", "decimal");
  });

  it("asks for a numeric keypad for an integer question", () => {
    expect(renderNumber({}, aNumberItem({ numberKind: "integer" }))).toHaveAttribute("inputmode", "numeric");
  });

  it("shows the unit after the input and uses it as the description", () => {
    const input = renderNumber();
    const unit = screen.getByText("kg");
    expect(input.compareDocumentPosition(unit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input).toHaveAccessibleDescription("kg");
  });

  it("shows no unit and no description for a unitless question", () => {
    const input = renderNumber({}, aNumberItem({ unit: undefined }));
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("reports the typed text as a decimal-string value, never a JSON number and never a unit", () => {
    const onChange = vi.fn();
    fireEvent.change(renderNumber({ onChange }), { target: { value: "72.5" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_06", { type: "number", value: "72.5" });
  });

  it("reports a cleared input as null", () => {
    const onChange = vi.fn();
    fireEvent.change(renderNumber({ onChange, answers: { itm_06: { type: "number", value: "72.5" } } }), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_06", null);
  });

  it("is controlled by the answers prop", () => {
    const input = renderNumber({ answers: { itm_06: { type: "number", value: "72.5" } } });
    expect(input).toHaveValue("72.5");
    fireEvent.change(input, { target: { value: "80" } });
    expect(input).toHaveValue("72.5");
  });

  it("is read-only in readonly mode and reports no change", () => {
    const onChange = vi.fn();
    const input = renderNumber({ onChange, mode: "readonly" });
    expect(input).toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "1" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("describes an error with the catalogue message followed by the unit", () => {
    const input = renderNumber({ errors: { itm_06: ["number/out-of-range"] } });
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a number between 0 kg and 300 kg. kg");
  });
});
