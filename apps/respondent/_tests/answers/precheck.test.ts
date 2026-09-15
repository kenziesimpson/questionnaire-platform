import type { ClientAnswers } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { precheckAnswers } from "../../src/answers/precheck.ts";
import { intakeV1 } from "../fixtures.ts";

const LATE_EVENING_UTC = new Date("2026-09-14T23:30:00Z");

const yesBranch = (date: string): ClientAnswers => ({
  itm_01: { type: "single_choice", optionId: "yes" },
  itm_02: { type: "single_choice", optionId: "opt_diabetes" },
  itm_03: { type: "date", date },
  itm_04: { type: "text", text: "Corner pharmacy" },
});

describe("precheckAnswers", () => {
  it("passes a complete, valid set of visible answers", () => {
    expect(precheckAnswers(intakeV1, yesBranch("2019-04-02"), LATE_EVENING_UTC, "UTC")).toBeUndefined();
  });

  it("resolves not_future against the browser's local date, not UTC", () => {
    const localTomorrowInUtc = yesBranch("2026-09-15");

    expect(precheckAnswers(intakeV1, localTomorrowInUtc, LATE_EVENING_UTC, "UTC")).toEqual({
      itemErrors: { itm_03: ["date/in-future"] },
    });
    expect(precheckAnswers(intakeV1, localTomorrowInUtc, LATE_EVENING_UTC, "Pacific/Auckland")).toBeUndefined();
  });

  it("reports unanswered visible required items", () => {
    expect(precheckAnswers(intakeV1, { itm_01: { type: "single_choice", optionId: "yes" } }, LATE_EVENING_UTC, "UTC")).toEqual({
      itemErrors: { itm_02: ["answer/required"], itm_03: ["answer/required"], itm_04: ["answer/required"] },
    });
  });

  it("ignores answers held for hidden and unknown items, since only visible answers are submitted", () => {
    const answers: ClientAnswers = {
      ...yesBranch("2999-01-01"),
      itm_01: { type: "single_choice", optionId: "no" },
      itm_gone: { type: "text", text: "from an older build" },
    };

    expect(precheckAnswers(intakeV1, answers, LATE_EVENING_UTC, "UTC")).toBeUndefined();
  });
});
