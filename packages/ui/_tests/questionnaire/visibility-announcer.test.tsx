import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuestionnaireItems } from "../../src/questionnaire";
import { describeVisibilityChange } from "../../src/questionnaire/visibility-announcer";
import type { RendererProps } from "../../src/questionnaire/types";
import type { Item } from "@qp/shared";
import { answeredNo, answeredYes, diagnosedOn, hasCondition, pharmacy, rendererProps, whichCondition } from "../fixtures";

function renderItems(visibleItems: readonly Item[], props: RendererProps = rendererProps()) {
  const view = render(<QuestionnaireItems visibleItems={visibleItems} {...props} />);
  return {
    region: () => screen.getByRole("status"),
    show: (next: readonly Item[], nextProps: RendererProps = props) =>
      view.rerender(<QuestionnaireItems visibleItems={next} {...nextProps} />),
  };
}

describe("visibility announcements", () => {
  it("renders a polite live region that is present and empty before anything changes", () => {
    const { region } = renderItems(answeredNo);
    expect(region()).toHaveAttribute("aria-live", "polite");
    expect(region()).toBeEmptyDOMElement();
  });

  it("announces the questions revealed by a branch opening, by prompt and in order", () => {
    const { region, show } = renderItems(answeredNo);
    show(answeredYes);
    expect(region()).toHaveTextContent("2 questions added: Which condition?; When were you diagnosed?.");
  });

  it("announces the questions removed by a branch closing", () => {
    const { region, show } = renderItems(answeredYes);
    show(answeredNo);
    expect(region()).toHaveTextContent("2 questions removed: Which condition?; When were you diagnosed?.");
  });

  it("announces additions and removals together when one answer causes both", () => {
    const { region, show } = renderItems([hasCondition, whichCondition, pharmacy]);
    show([hasCondition, diagnosedOn, pharmacy]);
    expect(region()).toHaveTextContent("1 question added: When were you diagnosed?. 1 question removed: Which condition?.");
  });

  it("leaves the last announcement alone when an answer changes but the visible set does not", () => {
    const { region, show } = renderItems(answeredNo);
    show(answeredYes);
    show([...answeredYes], rendererProps({ answers: { itm_03: { type: "date", date: "2019-04-02" } } }));
    expect(region()).toHaveTextContent("2 questions added: Which condition?; When were you diagnosed?.");
  });

  it("never carries an answer value", () => {
    const answers = { itm_03: { type: "date", date: "2019-04-02" } } as const;
    const { region, show } = renderItems(answeredYes, rendererProps({ answers }));
    show(answeredNo, rendererProps({ answers }));
    expect(region().textContent).not.toContain("2019-04-02");
  });

  it("describes no change as an empty string", () => {
    expect(describeVisibilityChange(answeredYes, [...answeredYes])).toBe("");
  });
});
