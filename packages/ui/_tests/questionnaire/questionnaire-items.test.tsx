import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuestionnaireItems } from "../../src/questionnaire";
import { answeredNo, answeredYes, rendererProps } from "../fixtures";

function renderedItemIds(container: HTMLElement): (string | undefined)[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-item-id]"), (element) => element.dataset.itemId);
}

describe("QuestionnaireItems", () => {
  it("renders exactly the visible items, in the order given", () => {
    const { container } = render(<QuestionnaireItems visibleItems={answeredYes} {...rendererProps()} />);
    expect(renderedItemIds(container)).toEqual(["itm_01", "itm_02", "itm_03", "itm_04"]);
  });

  it("removes the controls of items that leave the visible set and keeps the rest in place", () => {
    const props = rendererProps();
    const { container, rerender } = render(<QuestionnaireItems visibleItems={answeredYes} {...props} />);
    rerender(<QuestionnaireItems visibleItems={answeredNo} {...props} />);
    expect(renderedItemIds(container)).toEqual(["itm_01", "itm_04"]);
    expect(screen.queryByLabelText("When were you diagnosed?", { exact: false })).not.toBeInTheDocument();
  });

  it("renders nothing but the live region for an empty visible set", () => {
    const { container } = render(<QuestionnaireItems visibleItems={[]} {...rendererProps()} />);
    expect(renderedItemIds(container)).toEqual([]);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
