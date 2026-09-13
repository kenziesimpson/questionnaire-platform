import { render, screen } from "@testing-library/react";
import { SUBMISSION_ITEM_CODES, type Item } from "@qp/shared";
import { describe, expect, it } from "vitest";
import {
  CODES_WITHOUT_A_RENDERED_ITEM,
  ITEM_ERROR_MESSAGES,
  itemErrorMessage,
  QuestionnaireItems,
  type RenderedItemErrorCode,
} from "../../src/questionnaire";
import { aDateItem, aNumberItem, aSymptomsItem, aTextItem, rendererProps, whichCondition } from "../fixtures";

describe("the item error catalogue", () => {
  it("has a message for every submission code that can attach to a rendered item", () => {
    const expected = new Set<string>(SUBMISSION_ITEM_CODES);
    for (const code of CODES_WITHOUT_A_RENDERED_ITEM) expected.delete(code);
    expect(new Set(Object.keys(ITEM_ERROR_MESSAGES))).toEqual(expected);
  });

  it("has no message for the codes that never attach to a rendered item", () => {
    for (const code of CODES_WITHOUT_A_RENDERED_ITEM) expect(Object.hasOwn(ITEM_ERROR_MESSAGES, code)).toBe(false);
  });

  it.each([
    ["answer/required", aTextItem(), "Answer this question."],
    ["text/too-short", aTextItem({ minLength: 3 }), "Enter at least 3 characters."],
    ["text/too-long", aTextItem({ maxLength: 120 }), "Enter no more than 120 characters."],
    ["choice/too-few", aSymptomsItem(), "Choose at least 1 option."],
    ["choice/too-many", aSymptomsItem(), "Choose no more than 2 options."],
    ["choice/other-text-required", whichCondition, 'Enter your answer for "Other".'],
    ["choice/other-text-without-other", aSymptomsItem(), 'Select "Other" to use your own answer, or clear the text.'],
    ["number/not-integer", aNumberItem(), "Enter a whole number."],
    ["number/out-of-range", aNumberItem(), "Enter a number between 0 kg and 300 kg."],
    ["number/out-of-range", aNumberItem({ max: undefined, unit: undefined }), "Enter a number of at least 0."],
    ["date/out-of-range", aDateItem({ min: "1900-01-01", max: "2030-12-31" }), "Enter a date between 1900-01-01 and 2030-12-31."],
    ["date/out-of-range", aDateItem({ max: "2030-12-31" }), "Enter a date on or before 2030-12-31."],
    ["date/in-future", aDateItem(), "Enter a date that is not in the future."],
    ["date/in-past", aDateItem(), "Enter a date that is not in the past."],
  ] as [RenderedItemErrorCode, Item, string][])("%s reads from the question's own constraints", (code, item, message) => {
    expect(itemErrorMessage([code], item.question)).toBe(message);
  });

  it("falls back to a constraint-free message when the question does not carry the bound", () => {
    expect(itemErrorMessage(["text/too-long"], aTextItem().question)).toBe("This answer is too long.");
  });

  it("shows the first code when an item has several", () => {
    expect(itemErrorMessage(["date/in-future", "answer/required"], aDateItem().question)).toBe("Enter a date that is not in the future.");
  });

  it("skips codes that never attach to a rendered item and yields nothing when only those are present", () => {
    expect(itemErrorMessage(["answer/not-visible", "date/in-past"], aDateItem().question)).toBe("Enter a date that is not in the past.");
    expect(itemErrorMessage(["answer/not-visible", "answer/unknown-item"], aDateItem().question)).toBeUndefined();
    expect(itemErrorMessage([], aDateItem().question)).toBeUndefined();
    expect(itemErrorMessage(undefined, aDateItem().question)).toBeUndefined();
  });

  it("never echoes an answer: messages are built from the question alone", () => {
    const item = aTextItem({ maxLength: 5 });
    render(
      <QuestionnaireItems
        visibleItems={[item]}
        {...rendererProps({ answers: { itm_07: { type: "text", text: "SENTINEL-ANSWER" } }, errors: { itm_07: ["text/too-long"] } })}
      />,
    );
    expect(screen.getByText("Enter no more than 5 characters.")).toBeInTheDocument();
    expect(screen.queryByText(/SENTINEL-ANSWER/)).not.toBeInTheDocument();
  });

  it("renders no error and no aria-invalid for an item whose only code has no rendered item", () => {
    render(<QuestionnaireItems visibleItems={[aDateItem()]} {...rendererProps({ errors: { itm_03: ["answer/not-visible"] } })} />);
    expect(screen.getByLabelText("When were you diagnosed?", { exact: false })).not.toHaveAttribute("aria-invalid");
  });
});
