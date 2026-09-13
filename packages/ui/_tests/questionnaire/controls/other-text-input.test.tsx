import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuestionnaireItems } from "../../../src/questionnaire";
import { aSymptomsItem, rendererProps, whichCondition } from "../../fixtures";

const OTHER_NAME = "Other, please specify";

describe.each([
  ["single choice", whichCondition],
  ["multiple choice", aSymptomsItem()],
])("the %s other text box hint", (_, item) => {
  function renderOther() {
    render(<QuestionnaireItems visibleItems={[item]} {...rendererProps()} />);
    return screen.getByRole("textbox", { name: OTHER_NAME });
  }

  it("uses the option label as its hint", () => {
    expect(renderOther()).toHaveAttribute("placeholder", "Other");
  });

  it("hides the hint while the box has focus, via a focus-scoped placeholder colour", () => {
    expect(renderOther()).toHaveClass("focus:placeholder:text-transparent");
  });

  it("takes its accessible name from aria-label, not from the hint", () => {
    const box = renderOther();
    box.removeAttribute("placeholder");
    expect(box).toHaveAccessibleName(OTHER_NAME);
  });
});
