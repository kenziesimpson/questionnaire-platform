import { problem, type ClientAnswers } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { submissionRejectionOf, withoutItemError } from "../../src/answers/submission-rejection.ts";
import { intakeV1 } from "../fixtures.ts";

const yesBranch: ClientAnswers = { itm_01: { type: "single_choice", optionId: "yes" } };
const noBranch: ClientAnswers = { itm_01: { type: "single_choice", optionId: "no" } };

describe("submissionRejectionOf", () => {
  it("places every error on a shown item", () => {
    const body = problem("submission/invalid", {
      items: [
        { itemId: "itm_03", code: "date/in-future" },
        { itemId: "itm_04", code: "text/too-long" },
        { itemId: "itm_04", code: "answer/required" },
      ],
    });

    expect(submissionRejectionOf(intakeV1, yesBranch, body)).toEqual({
      itemErrors: { itm_03: ["date/in-future"], itm_04: ["text/too-long", "answer/required"] },
      unplacedErrors: false,
    });
  });

  it("flags codes the grouping drops alongside the errors it places", () => {
    const body = problem("submission/invalid", {
      items: [
        { itemId: "itm_04", code: "text/too-long" },
        { itemId: "itm_02", code: "answer/not-visible" },
      ],
    });

    expect(submissionRejectionOf(intakeV1, noBranch, body)).toEqual({ itemErrors: { itm_04: ["text/too-long"] }, unplacedErrors: true });
  });

  it.each([
    ["an unknown item", [{ itemId: "itm_99", code: "answer/unknown-item" } as const]],
    ["an item hidden by the answers", [{ itemId: "itm_03", code: "answer/required" } as const]],
    ["no items", []],
  ])("flags a rejection with nothing to place: %s", (_case, items) => {
    expect(submissionRejectionOf(intakeV1, noBranch, problem("submission/invalid", { items }))).toEqual({ itemErrors: {}, unplacedErrors: true });
  });
});

describe("withoutItemError", () => {
  const rejection = { itemErrors: { itm_03: ["date/in-future"], itm_04: ["text/too-long"] }, unplacedErrors: true } as const;

  it("drops only the changed item's errors and keeps the unplaced flag", () => {
    expect(withoutItemError(rejection, "itm_04")).toEqual({ itemErrors: { itm_03: ["date/in-future"] }, unplacedErrors: true });
  });

  it("returns the same rejection when the item had no server error", () => {
    expect(withoutItemError(rejection, "itm_01")).toBe(rejection);
  });
});
