import type { ClientAnswers } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { errorSummaryEntries, errorSummaryTitle } from "../../src/screens/error-summary.tsx";
import { intakeV1 } from "../fixtures.ts";

const yesBranch: ClientAnswers = { itm_01: { type: "single_choice", optionId: "yes" } };

describe("errorSummaryEntries", () => {
  it("lists shown items in form order with the catalogue message for their first code", () => {
    const entries = errorSummaryEntries(intakeV1, yesBranch, {
      itm_04: ["text/too-long", "answer/required"],
      itm_02: ["answer/required"],
    });

    expect(entries).toEqual([
      { itemId: "itm_02", prompt: "Which condition?", message: "Answer this question." },
      { itemId: "itm_04", prompt: "Preferred pharmacy", message: "Enter no more than 120 characters." },
    ]);
  });

  it("leaves out items the answers hide", () => {
    expect(errorSummaryEntries(intakeV1, { itm_01: { type: "single_choice", optionId: "no" } }, { itm_03: ["date/in-future"] })).toEqual([]);
  });
});

describe("errorSummaryTitle", () => {
  it.each([
    [0, "Your answers could not be submitted"],
    [1, "1 answer needs attention"],
    [3, "3 answers need attention"],
  ])("titles %i entries as %s", (count, title) => {
    expect(errorSummaryTitle(count)).toBe(title);
  });
});
