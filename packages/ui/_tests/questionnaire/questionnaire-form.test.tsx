import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { visibleItems, type ClientAnswers, type PublishedDefinition } from "@qp/shared";
import { describe, expect, it, vi } from "vitest";
import { QuestionnaireForm } from "../../src/questionnaire";
import { intakeV1, rendererProps } from "../fixtures";

function StatefulForm({ definition, initial = {} }: { definition: PublishedDefinition; initial?: ClientAnswers }) {
  const [answers, setAnswers] = useState<ClientAnswers>(initial);
  return (
    <QuestionnaireForm
      definition={definition}
      answers={answers}
      errors={{}}
      mode="interactive"
      onChange={(itemId, answer) => setAnswers((current) => ({ ...current, [itemId]: answer }))}
    />
  );
}

function renderedItemIds(container: HTMLElement): (string | undefined)[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-item-id]"), (element) => element.dataset.itemId);
}

function hasConditionGroup() {
  return screen.getByRole("radiogroup", { name: /Do you have a medical condition\?/ });
}

describe("QuestionnaireForm on the seeded intake definition", () => {
  it("starts with only the unconditional questions", () => {
    const { container } = render(<StatefulForm definition={intakeV1} />);
    expect(renderedItemIds(container)).toEqual(["itm_01", "itm_04"]);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("reveals the condition and diagnosis questions between the first and last on yes, and announces them", async () => {
    const { container } = render(<StatefulForm definition={intakeV1} />);
    await userEvent.click(within(hasConditionGroup()).getByRole("radio", { name: "Yes" }));
    expect(renderedItemIds(container)).toEqual(["itm_01", "itm_02", "itm_03", "itm_04"]);
    expect(screen.getByRole("radiogroup", { name: /Which condition\?/ })).toBeInTheDocument();
    expect(screen.getByLabelText("When were you diagnosed?", { exact: false })).toHaveAttribute("type", "date");
    expect(screen.getByRole("status")).toHaveTextContent("2 questions added: Which condition?; When were you diagnosed?.");
  });

  it("removes them again on no and announces the removal", async () => {
    const { container } = render(<StatefulForm definition={intakeV1} />);
    await userEvent.click(within(hasConditionGroup()).getByRole("radio", { name: "Yes" }));
    await userEvent.click(within(hasConditionGroup()).getByRole("radio", { name: "No" }));
    expect(renderedItemIds(container)).toEqual(["itm_01", "itm_04"]);
    expect(screen.queryByText("Which condition?")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 questions removed: Which condition?; When were you diagnosed?.");
  });

  it("restores a hidden answer when the branch reopens, because the answers prop still holds it", async () => {
    render(
      <StatefulForm
        definition={intakeV1}
        initial={{ itm_01: { type: "single_choice", optionId: "no" }, itm_03: { type: "date", date: "2019-04-02" } }}
      />,
    );
    expect(screen.queryByLabelText("When were you diagnosed?", { exact: false })).not.toBeInTheDocument();
    await userEvent.click(within(hasConditionGroup()).getByRole("radio", { name: "Yes" }));
    expect(screen.getByLabelText("When were you diagnosed?", { exact: false })).toHaveValue("2019-04-02");
  });

  it.each<[string, ClientAnswers]>([
    ["no answers", {}],
    ["yes", { itm_01: { type: "single_choice", optionId: "yes" } }],
    ["no", { itm_01: { type: "single_choice", optionId: "no" } }],
    ["no with a stale branch answer", { itm_01: { type: "single_choice", optionId: "no" }, itm_02: { type: "single_choice", optionId: "opt_diabetes" } }],
  ])("renders exactly the shared engine's visibleItems for %s", (_, answers) => {
    const { container } = render(<QuestionnaireForm definition={intakeV1} {...rendererProps({ answers })} />);
    expect(renderedItemIds(container)).toEqual(visibleItems(intakeV1, answers).map((item) => item.itemId));
  });

  it("holds no answer state: without the parent updating answers, choosing yes reveals nothing", async () => {
    const onChange = vi.fn();
    const { container } = render(<QuestionnaireForm definition={intakeV1} {...rendererProps({ onChange })} />);
    await userEvent.click(within(hasConditionGroup()).getByRole("radio", { name: "Yes" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("itm_01", { type: "single_choice", optionId: "yes" });
    expect(renderedItemIds(container)).toEqual(["itm_01", "itm_04"]);
  });
});
