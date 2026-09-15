import { answerFor, type ClientAnswerValue, type ClientAnswers, type Item, type QuestionInput } from "@qp/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SampleAnswerInput } from "../../../src/screens/version-preview/sample-answer-input";
import { QUESTION_ID } from "../../fixtures";

function anItemAsking(question: QuestionInput): Item {
  return {
    itemId: "itm_01",
    required: false,
    visibleWhen: null,
    question: { questionId: QUESTION_ID, questionVersion: 1, ...question },
  };
}

function renderSample(question: QuestionInput) {
  const reported: (ClientAnswerValue | null)[] = [];
  function Harness() {
    const [answers, setAnswers] = useState<ClientAnswers>({});
    return (
      <SampleAnswerInput
        item={anItemAsking(question)}
        label="1. Sample"
        answer={answerFor(answers, "itm_01")}
        onChange={(itemId, answer) => {
          reported.push(answer);
          setAnswers((current) => ({ ...current, [itemId]: answer }));
        }}
      />
    );
  }
  render(<Harness />);
  return reported;
}

const options = [
  { optionId: "opt_a", label: "Alpha" },
  { optionId: "opt_b", label: "Beta" },
  { optionId: "other", label: "Other", freeform: true },
];

describe("a sample answer input", () => {
  it("is a text box for a text question, reporting the text and null once cleared", async () => {
    const reported = renderSample({ type: "text", prompt: "Sample" });
    const box = screen.getByRole("textbox", { name: "1. Sample" });

    await userEvent.type(box, "ab");
    await userEvent.clear(box);

    expect(reported).toEqual([{ type: "text", text: "a" }, { type: "text", text: "ab" }, null]);
  });

  it("is a radio group with an Unanswered choice for a single-choice question", async () => {
    const reported = renderSample({ type: "single_choice", prompt: "Sample", options });

    expect(screen.getByRole("group", { name: "1. Sample" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
    await userEvent.click(screen.getByRole("radio", { name: "Beta" }));
    await userEvent.click(screen.getByRole("radio", { name: "Unanswered" }));

    expect(reported).toEqual([{ type: "single_choice", optionId: "opt_b" }, null]);
  });

  it("is a checkbox per option for a multiple-choice question, reporting option ids in option order and null when none", async () => {
    const reported = renderSample({ type: "multiple_choice", prompt: "Sample", options });

    expect(screen.getByRole("group", { name: "1. Sample" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));

    expect(reported).toEqual([
      { type: "multiple_choice", optionIds: ["other"] },
      { type: "multiple_choice", optionIds: ["opt_a", "other"] },
      { type: "multiple_choice", optionIds: ["opt_a"] },
      null,
    ]);
  });

  it("is a decimal text box with its unit for a number question, reporting a decimal string", async () => {
    const reported = renderSample({ type: "number", prompt: "Sample", numberKind: "float", unit: "kg" });
    const box = screen.getByRole("textbox", { name: "1. Sample" });

    expect(box).toHaveAttribute("inputmode", "decimal");
    expect(box).toHaveAccessibleDescription("kg");
    await userEvent.type(box, "7.5");

    expect(reported.at(-1)).toEqual({ type: "number", value: "7.5" });
  });

  it("is a native date input for a date question, reporting the ISO date and null once cleared", () => {
    const reported = renderSample({ type: "date", prompt: "Sample", relative: "not_future" });
    const input = screen.getByLabelText("1. Sample");

    expect(input).toHaveAttribute("type", "date");
    fireEvent.change(input, { target: { value: "2019-04-02" } });
    fireEvent.change(input, { target: { value: "" } });

    expect(reported).toEqual([{ type: "date", date: "2019-04-02" }, null]);
  });
});
