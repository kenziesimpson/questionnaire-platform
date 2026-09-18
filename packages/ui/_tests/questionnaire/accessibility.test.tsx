import { render } from "@testing-library/react";
import type { ClientAnswers } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { QuestionnaireItems } from "../../src/questionnaire";
import { axeViolations } from "../../src/testing";
import { answeredNo, answeredYes, aNumberItem, aSymptomsItem, aTextItem, everyType, rendererProps } from "../fixtures";

const everyTypeAnswered: ClientAnswers = {
  itm_01: { type: "single_choice", optionId: "yes" },
  itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" },
  itm_03: { type: "date", date: "2019-04-02" },
  itm_04: { type: "text", text: "Corner pharmacy" },
  itm_05: { type: "multiple_choice", optionIds: ["opt_cough", "other"], otherText: "Rash" },
  itm_06: { type: "number", value: "72.5" },
  itm_07: { type: "text", text: "None" },
};

const everyTypeInError = {
  itm_01: ["answer/required"],
  itm_02: ["choice/other-text-required"],
  itm_03: ["date/in-future"],
  itm_04: ["text/too-long"],
  itm_05: ["choice/too-many"],
  itm_06: ["number/out-of-range"],
  itm_07: ["text/too-short"],
} as const;

describe("axe on the renderer", () => {
  it.each([
    ["the demo after answering no", answeredNo, rendererProps()],
    ["the demo after answering yes", answeredYes, rendererProps()],
    ["every response type unanswered", everyType, rendererProps()],
    ["every response type answered, including both other text boxes", everyType, rendererProps({ answers: everyTypeAnswered })],
    ["every response type carrying an error", everyType, rendererProps({ errors: everyTypeInError })],
    ["every response type in a readonly preview", everyType, rendererProps({ mode: "readonly", answers: everyTypeAnswered })],
    ["a required multiple choice group", [aSymptomsItem({ required: true })], rendererProps()],
    ["an integer without a unit", [aNumberItem({ numberKind: "integer", unit: undefined })], rendererProps()],
    ["a single-line text question", [aTextItem({ required: true })], rendererProps()],
  ])("finds no violations for %s", async (_, visibleItems, props) => {
    const { container } = render(<QuestionnaireItems visibleItems={visibleItems} {...props} />);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("finds no violations once a reveal has been announced", async () => {
    const props = rendererProps();
    const { container, rerender } = render(<QuestionnaireItems visibleItems={answeredNo} {...props} />);
    rerender(<QuestionnaireItems visibleItems={answeredYes} {...props} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
