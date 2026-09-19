import type { QuestionContent, ResponseRow } from "@qp/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnswerDisplay, questionTypeLabel, visibilityRuleLabel } from "../../../src/screens/response-detail/answer-display";

const QUESTION_ID = "01a0950f-4100-7fcc-8acc-05dc6b75ce33";
const head = { itemId: "itm_01", questionId: QUESTION_ID, questionVersion: 1 };

const choiceQuestion = (type: "single_choice" | "multiple_choice"): QuestionContent => ({
  questionId: QUESTION_ID,
  questionVersion: 1,
  type,
  prompt: "Which?",
  options: [
    { optionId: "opt_a", label: "Alpha" },
    { optionId: "opt_b", label: "Beta" },
    { optionId: "other", label: "Other", freeform: true },
  ],
});

const numberQuestion: QuestionContent = {
  questionId: QUESTION_ID,
  questionVersion: 1,
  type: "number",
  prompt: "How much?",
  numberKind: "float",
};

const textQuestion: QuestionContent = { questionId: QUESTION_ID, questionVersion: 1, type: "text", prompt: "Say", maxLength: 100 };

const dateQuestion: QuestionContent = { questionId: QUESTION_ID, questionVersion: 1, type: "date", prompt: "When?" };

function show(question: QuestionContent, answer: ResponseRow) {
  return render(<AnswerDisplay question={question} answer={answer} />);
}

describe("AnswerDisplay", () => {
  it("shows a text answer as written", () => {
    show(textQuestion, { ...head, type: "text", text: "Corner Pharmacy" });

    expect(screen.getByText("Corner Pharmacy")).toBeInTheDocument();
    expect(screen.queryByText(/stored as/)).not.toBeInTheDocument();
  });

  it("shows a number exactly as stored, with its unit when there is one", () => {
    const { unmount } = show(numberQuestion, { ...head, type: "number", number: "72.5", unit: "kg" });
    expect(screen.getByText("72.5 kg")).toBeInTheDocument();
    unmount();

    show(numberQuestion, { ...head, type: "number", number: "-0.50" });
    expect(screen.getByText("-0.50")).toBeInTheDocument();
  });

  it("shows a date as a calendar date, next to the ISO value it is stored as, without shifting the day", () => {
    show(dateQuestion, { ...head, type: "date", date: "2020-02-29" });

    expect(screen.getByText("29 Feb 2020")).toBeInTheDocument();
    expect(screen.getByText("2020-02-29")).toBeInTheDocument();
    expect(screen.getByText(/stored as/)).toBeInTheDocument();
  });

  it("shows a single choice by its label with the option id it is stored as", () => {
    show(choiceQuestion("single_choice"), { ...head, type: "single_choice", optionIds: ["opt_b"] });

    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("opt_b")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("shows every selected option of a multiple choice, in stored order", () => {
    const { container } = show(choiceQuestion("multiple_choice"), { ...head, type: "multiple_choice", optionIds: ["opt_b", "opt_a"] });

    expect(Array.from(container.querySelectorAll(".font-medium")).map((label) => label.textContent)).toEqual(["Beta", "Alpha"]);
    expect(screen.getByText("opt_a")).toBeInTheDocument();
    expect(screen.getByText("opt_b")).toBeInTheDocument();
  });

  it("shows the freeform text of an Other choice as its own line", () => {
    show(choiceQuestion("single_choice"), { ...head, type: "single_choice", optionIds: ["other"], otherText: "Long COVID" });

    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByText("Long COVID")).toBeInTheDocument();
    expect(screen.getByText("other, freeform")).toBeInTheDocument();
  });

  it("falls back to the stored option id when the pinned question has no such option, rather than hiding the answer", () => {
    show(choiceQuestion("single_choice"), { ...head, type: "single_choice", optionIds: ["opt_gone"] });

    expect(screen.getAllByText("opt_gone")).toHaveLength(2);
  });

  it("falls back to the stored option id when the question is not a choice question", () => {
    show(textQuestion, { ...head, type: "single_choice", optionIds: ["opt_a"] });

    expect(screen.getAllByText("opt_a")).toHaveLength(2);
  });
});

describe("questionTypeLabel", () => {
  it.each([
    ["text", "Text"],
    ["single_choice", "Single choice"],
    ["multiple_choice", "Multiple choice"],
    ["number", "Number"],
    ["date", "Date"],
  ] as const)("labels %s as %s", (type, label) => {
    expect(questionTypeLabel(type)).toBe(label);
  });
});

describe("visibilityRuleLabel", () => {
  it("says an item with no rule is always shown", () => {
    expect(visibilityRuleLabel(null)).toBe("Always shown");
  });

  it("counts the conditions of an all rule, singular and plural", () => {
    expect(visibilityRuleLabel({ all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] })).toBe(
      "Shown when 1 condition is true",
    );
    expect(
      visibilityRuleLabel({
        all: [
          { type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" },
          { type: "single_choice", itemId: "itm_02", op: "is", optionId: "yes" },
        ],
      }),
    ).toBe("Shown when 2 conditions are true");
  });

  it("counts the conditions of an any rule the same way", () => {
    expect(visibilityRuleLabel({ any: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] })).toBe(
      "Shown when 1 condition is true",
    );
  });
});
