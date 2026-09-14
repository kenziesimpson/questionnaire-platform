import { render, screen } from "@testing-library/react";
import { problem, problemType, SUBMISSION_ITEM_CODES, type ProblemDetailsWire } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { CODES_WITHOUT_A_RENDERED_ITEM, errorsByItemId, QuestionnaireItems } from "../../src/questionnaire";
import { answeredYes, rendererProps } from "../fixtures";

const wireRejection: ProblemDetailsWire = {
  type: problemType("submission/invalid"),
  title: "The submission failed validation",
  status: 422,
  instance: "/api/run/sessions/01a0951b/submit",
  items: [
    { itemId: "itm_02", code: "answer/required" },
    { itemId: "itm_03", code: "date/in-future" },
  ],
};

describe("errorsByItemId", () => {
  it("groups a submission rejection's items by itemId, keeping the server's order within each item", () => {
    const body = problem("submission/invalid", {
      items: [
        { itemId: "itm_03", code: "date/in-future" },
        { itemId: "itm_02", code: "answer/required" },
        { itemId: "itm_03", code: "date/out-of-range" },
      ],
    });

    expect(errorsByItemId(body)).toEqual({ itm_03: ["date/in-future", "date/out-of-range"], itm_02: ["answer/required"] });
  });

  it("reads the wire schema's type as well as a body built with problem()", () => {
    expect(errorsByItemId(wireRejection)).toEqual({ itm_02: ["answer/required"], itm_03: ["date/in-future"] });
  });

  it("drops answer/not-visible and answer/unknown-item, and leaves out an item carrying only those", () => {
    const body = problem("submission/invalid", {
      items: [
        { itemId: "itm_09", code: "answer/unknown-item" },
        { itemId: "itm_03", code: "answer/not-visible" },
        { itemId: "itm_04", code: "text/too-long" },
        { itemId: "itm_04", code: "answer/not-visible" },
      ],
    });

    expect(errorsByItemId(body)).toEqual({ itm_04: ["text/too-long"] });
  });

  it("keeps every submission code except the two without a rendered item", () => {
    const items = SUBMISSION_ITEM_CODES.map((code) => ({ itemId: "itm_01", code }));
    const expected = SUBMISSION_ITEM_CODES.filter((code) => !(CODES_WITHOUT_A_RENDERED_ITEM as readonly string[]).includes(code));

    expect(errorsByItemId(problem("submission/invalid", { items }))).toEqual({ itm_01: expected });
  });

  it("yields no errors for a problem that is not a submission rejection", () => {
    expect(errorsByItemId(problem("questionnaire/draft-invalid", { items: [{ itemId: "itm_03", code: "predicate/forward-reference" }] }))).toEqual({});
    expect(errorsByItemId(problem("request/invalid", { errors: [{ pointer: "/body/answers/itm_01", code: "schema/type" }] }))).toEqual({});
    expect(errorsByItemId(problem("session/already-submitted"))).toEqual({});
    expect(errorsByItemId({ ...problem("internal", { detail: "4bf92f3577b34da6a3ce929d0e0e4736" }), type: "https://qp.example/problems/made-up" })).toEqual({});
  });

  it("yields no errors for a submission rejection with no items", () => {
    expect(errorsByItemId(problem("submission/invalid", { items: [] }))).toEqual({});
  });

  it("feeds the renderer's errors prop, which shows each item's first code", () => {
    const body = problem("submission/invalid", {
      items: [
        { itemId: "itm_02", code: "answer/required" },
        { itemId: "itm_03", code: "date/in-future" },
        { itemId: "itm_03", code: "answer/required" },
        { itemId: "itm_04", code: "answer/not-visible" },
      ],
    });

    render(<QuestionnaireItems visibleItems={answeredYes} {...rendererProps({ errors: errorsByItemId(body) })} />);

    expect(screen.getAllByText("Answer this question.")).toHaveLength(1);
    expect(screen.getByText("Enter a date that is not in the future.")).toBeInTheDocument();
  });
});
