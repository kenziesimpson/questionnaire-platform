import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionnaireItems } from "../../../src/questionnaire";
import { aTextItem, rendererProps } from "../../fixtures";

const PROMPT = "Anything else we should know?";

function renderText(overrides: Parameters<typeof rendererProps>[0] = {}, item = aTextItem()) {
  render(<QuestionnaireItems visibleItems={[item]} {...rendererProps(overrides)} />);
  return screen.getByRole("textbox", { name: PROMPT });
}

describe("text control", () => {
  it("is a single-line input named by the prompt", () => {
    const input = renderText();
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("type", "text");
  });

  it("is a textarea when the question is multiline", () => {
    expect(renderText({}, aTextItem({ multiline: true })).tagName).toBe("TEXTAREA");
  });

  it.each([
    ["input", aTextItem()],
    ["textarea", aTextItem({ multiline: true })],
  ])("reports typed text keyed by itemId from the %s", (_, item) => {
    const onChange = vi.fn();
    fireEvent.change(renderText({ onChange }, item), { target: { value: "Allergic to penicillin" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_07", { type: "text", text: "Allergic to penicillin" });
  });

  it("reports cleared text as null", () => {
    const onChange = vi.fn();
    const input = renderText({ onChange, answers: { itm_07: { type: "text", text: "x" } } });
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_07", null);
  });

  it("is controlled by the answers prop", () => {
    const input = renderText({ answers: { itm_07: { type: "text", text: "Allergic" } } });
    expect(input).toHaveValue("Allergic");
    fireEvent.change(input, { target: { value: "Something else" } });
    expect(input).toHaveValue("Allergic");
  });

  it("is read-only in readonly mode and reports no change", () => {
    const onChange = vi.fn();
    const input = renderText({ onChange, mode: "readonly" });
    expect(input).toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "x" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("carries aria-required, aria-invalid and the catalogue message as its description", () => {
    const input = renderText({ errors: { itm_07: ["text/too-long"] } }, aTextItem({ required: true, maxLength: 120 }));
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter no more than 120 characters.");
  });
});
