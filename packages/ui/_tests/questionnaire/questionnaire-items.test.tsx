import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionnaireItems } from "../../src/questionnaire";
import { answeredNo, answeredYes, hasCondition, pharmacy, rendererProps } from "../fixtures";

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

  it("labels each item with labelFor instead of its own prompt, by index in the visible list", () => {
    const labelFor = (item: (typeof answeredNo)[number], index: number) => `${index + 1}. ${item.question.prompt}`;
    render(<QuestionnaireItems visibleItems={answeredNo} labelFor={labelFor} {...rendererProps()} />);
    expect(screen.getByRole("radiogroup", { name: /^1\. Do you have a medical condition\?/ })).toBeInTheDocument();
    expect(screen.getByLabelText("2. Preferred pharmacy", { exact: false, selector: "input" })).toBeInTheDocument();
  });

  it("renders no Clear button without onClear", () => {
    render(<QuestionnaireItems visibleItems={[pharmacy]} {...rendererProps()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers a per-item Clear button when onClear is given, disabled until the item has an answer", async () => {
    const onClear = vi.fn();
    render(
      <QuestionnaireItems
        visibleItems={[hasCondition, pharmacy]}
        onClear={onClear}
        {...rendererProps({ answers: { itm_04: { type: "text", text: "Boots" } } })}
      />,
    );
    expect(screen.getByRole("button", { name: /Clear.*Do you have a medical condition\?/ })).toBeDisabled();
    const clearPharmacy = screen.getByRole("button", { name: /Clear.*Preferred pharmacy/ });
    expect(clearPharmacy).toBeEnabled();

    await userEvent.click(clearPharmacy);

    expect(onClear).toHaveBeenCalledExactlyOnceWith("itm_04");
  });

  it("renders no Clear button in readonly mode even when onClear is given", () => {
    render(<QuestionnaireItems visibleItems={[pharmacy]} onClear={vi.fn()} {...rendererProps({ mode: "readonly" })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the visibility-change live region by default, and can suppress it with announceVisibility={false}", () => {
    const props = rendererProps();
    const suppressed = render(<QuestionnaireItems visibleItems={answeredNo} announceVisibility={false} {...props} />);
    expect(suppressed.queryByRole("status")).not.toBeInTheDocument();

    const announced = render(<QuestionnaireItems visibleItems={answeredNo} {...props} />);
    expect(announced.getByRole("status")).toBeInTheDocument();
  });
});
