import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { QuestionnaireItems } from "../../src/questionnaire";
import { answeredNo, answeredYes, rendererProps } from "../fixtures";

const JSDOM_CANNOT_EVALUATE = { "color-contrast": { enabled: false } };

async function violationsIn(container: HTMLElement) {
  const results = await axe.run(container, { rules: JSDOM_CANNOT_EVALUATE });
  return results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
}

const answered = { itm_03: { type: "date", date: "2019-04-02" } } as const;

describe("axe on the renderer", () => {
  it.each([
    ["the demo after answering no", answeredNo, rendererProps()],
    ["the demo after answering yes", answeredYes, rendererProps()],
    ["an answered date", answeredYes, rendererProps({ answers: answered })],
    ["an item carrying an error", answeredYes, rendererProps({ errors: { itm_03: "Enter a date that is not in the future." } })],
    ["a readonly preview", answeredYes, rendererProps({ mode: "readonly", answers: answered })],
  ])("finds no violations for %s", async (_, visibleItems, props) => {
    const { container } = render(<QuestionnaireItems visibleItems={visibleItems} {...props} />);
    expect(await violationsIn(container)).toEqual([]);
  });

  it("finds no violations once a reveal has been announced", async () => {
    const props = rendererProps();
    const { container, rerender } = render(<QuestionnaireItems visibleItems={answeredNo} {...props} />);
    rerender(<QuestionnaireItems visibleItems={answeredYes} {...props} />);
    expect(await violationsIn(container)).toEqual([]);
  });
});
