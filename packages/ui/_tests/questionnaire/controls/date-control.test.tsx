import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionnaireItems } from "../../../src/questionnaire";
import { aDateItem, rendererProps } from "../../fixtures";

const PROMPT = "When were you diagnosed?";

function renderDate(overrides: Parameters<typeof rendererProps>[0] = {}, item = aDateItem()) {
  const props = rendererProps(overrides);
  render(<QuestionnaireItems visibleItems={[item]} {...props} />);
  return { input: screen.getByLabelText(PROMPT, { exact: false }), props };
}

describe("date control", () => {
  it("is a native date input whose accessible name is exactly the prompt", () => {
    const { input } = renderDate();
    expect(input).toHaveAccessibleName(PROMPT);
    expect(input).toHaveAttribute("type", "date");
    expect(input.tagName).toBe("INPUT");
  });

  it("reports a chosen date through onChange keyed by itemId", () => {
    const onChange = vi.fn();
    const { input } = renderDate({ onChange });
    fireEvent.change(input, { target: { value: "2019-04-02" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_03", { type: "date", date: "2019-04-02" });
  });

  it("reports a cleared date as null", () => {
    const onChange = vi.fn();
    const { input } = renderDate({ onChange, answers: { itm_03: { type: "date", date: "2019-04-02" } } });
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_03", null);
  });

  it("is controlled: it shows the answers prop and holds no value of its own", () => {
    const { input } = renderDate({ answers: { itm_03: { type: "date", date: "2019-04-02" } } });
    expect(input).toHaveValue("2019-04-02");
    fireEvent.change(input, { target: { value: "2020-01-01" } });
    expect(input).toHaveValue("2019-04-02");
  });

  it("ignores an answer shaped for a different response type", () => {
    const { input } = renderDate({ answers: { itm_03: { type: "text", text: "yesterday" } } });
    expect(input).toHaveValue("");
  });

  it("passes the question's absolute bounds to the input", () => {
    const { input } = renderDate({}, aDateItem({ min: "1900-01-01", max: "2030-12-31" }));
    expect(input).toHaveAttribute("min", "1900-01-01");
    expect(input).toHaveAttribute("max", "2030-12-31");
  });

  it("marks a required item aria-required", () => {
    expect(renderDate().input).toHaveAttribute("aria-required", "true");
  });

  it("does not mark an optional item aria-required", () => {
    const { input } = renderDate({}, aDateItem({ required: false }));
    expect(input).not.toHaveAttribute("aria-required");
  });

  it("is read-only in readonly mode and reports no change", () => {
    const onChange = vi.fn();
    const { input } = renderDate({ onChange, mode: "readonly" });
    expect(input).toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "2019-04-02" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("date control error state", () => {
  it("has no aria-invalid or description without an error", () => {
    const { input } = renderDate();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("points aria-describedby at the rendered error and sets aria-invalid", () => {
    const { input } = renderDate({ errors: { itm_03: "Enter a date that is not in the future." } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a date that is not in the future.");
  });

  it("ignores errors that belong to other items", () => {
    const { input } = renderDate({ errors: { itm_04: "Required." } });
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Required.")).not.toBeInTheDocument();
  });
});
