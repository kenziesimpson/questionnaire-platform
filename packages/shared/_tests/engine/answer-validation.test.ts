import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ResponseRow, type ClientAnswers, type ClientAnswerValue } from "../../src/domain/answer.js";
import type { QuestionContent } from "../../src/domain/question.js";
import { INTAKE_QUESTION_IDS, intakeDefinition } from "../../src/demo/intake.js";
import { validateAnswer, validateSubmission } from "../../src/engine/answer-validation.js";
import type { RelativeDateContext } from "../../src/engine/calendar.js";
import { aDefinition, all, anItem, questions } from "./fixtures.js";

const DATES: RelativeDateContext = { today: "2026-09-13", toleranceDays: 0 };

function codesFor(question: Parameters<typeof anItem>[1], answer: ClientAnswerValue, dates = DATES) {
  return validateAnswer(anItem("itm", question).question as QuestionContent, answer, dates);
}

describe("validateAnswer — per-type constraints", () => {
  it.each<[string, Parameters<typeof anItem>[1], ClientAnswerValue, string[]]>([
    ["text within bounds", questions.text({ minLength: 2, maxLength: 5 }), { type: "text", text: "Boots" }, []],
    ["text too short", questions.text({ minLength: 2 }), { type: "text", text: "B" }, ["text/too-short"]],
    ["text too long", questions.text({ maxLength: 5 }), { type: "text", text: "Walgreens" }, ["text/too-long"]],
    ["text length counts code points, not UTF-16 units", questions.text({ maxLength: 1 }), { type: "text", text: "💊" }, []],
    ["single_choice known option", questions.single(), { type: "single_choice", optionId: "a" }, []],
    ["single_choice unknown option", questions.single(), { type: "single_choice", optionId: "z" }, ["choice/unknown-option"]],
    ["single_choice other with text", questions.single(), { type: "single_choice", optionId: "other", otherText: "Asthma" }, []],
    ["single_choice other without text", questions.single(), { type: "single_choice", optionId: "other" }, ["choice/other-text-required"]],
    ["single_choice other with empty text", questions.single(), { type: "single_choice", optionId: "other", otherText: "" }, ["choice/other-text-required"]],
    [
      "single_choice other with whitespace-only text",
      questions.single(),
      { type: "single_choice", optionId: "other", otherText: " \t\n " },
      ["choice/other-text-required"],
    ],
    ["single_choice other with padded text", questions.single(), { type: "single_choice", optionId: "other", otherText: "  Asthma " }, []],
    [
      "single_choice otherText on a non-other option",
      questions.single(),
      { type: "single_choice", optionId: "a", otherText: "Asthma" },
      ["choice/other-text-without-other"],
    ],
    [
      "single_choice otherText when the question has no freeform other",
      questions.yesNo(),
      { type: "single_choice", optionId: "yes", otherText: "Asthma" },
      ["choice/other-text-without-other"],
    ],
    ["multiple_choice known options", questions.multiple(), { type: "multiple_choice", optionIds: ["a", "c"] }, []],
    [
      "multiple_choice duplicate option ids (#34)",
      questions.multiple(),
      { type: "multiple_choice", optionIds: ["a", "a"] },
      ["choice/duplicate-option"],
    ],
    [
      "multiple_choice unknown option",
      questions.multiple(),
      { type: "multiple_choice", optionIds: ["a", "z"] },
      ["choice/unknown-option"],
    ],
    [
      "multiple_choice too few",
      questions.multiple({ minSelections: 2 }),
      { type: "multiple_choice", optionIds: ["a"] },
      ["choice/too-few"],
    ],
    [
      "multiple_choice too many",
      questions.multiple({ maxSelections: 2 }),
      { type: "multiple_choice", optionIds: ["a", "b", "c"] },
      ["choice/too-many"],
    ],
    [
      "multiple_choice counts distinct selections against the bounds",
      questions.multiple({ minSelections: 2 }),
      { type: "multiple_choice", optionIds: ["a", "a"] },
      ["choice/duplicate-option", "choice/too-few"],
    ],
    [
      "multiple_choice other selected without text",
      questions.multiple(),
      { type: "multiple_choice", optionIds: ["a", "other"] },
      ["choice/other-text-required"],
    ],
    [
      "multiple_choice other selected with whitespace-only text",
      questions.multiple(),
      { type: "multiple_choice", optionIds: ["other"], otherText: "   " },
      ["choice/other-text-required"],
    ],
    ["multiple_choice other selected with text", questions.multiple(), { type: "multiple_choice", optionIds: ["other", "b"], otherText: "Rash" }, []],
    [
      "multiple_choice whitespace-only otherText without other selected",
      questions.multiple(),
      { type: "multiple_choice", optionIds: ["a"], otherText: " " },
      ["choice/other-text-without-other"],
    ],
    [
      "multiple_choice otherText without other selected",
      questions.multiple(),
      { type: "multiple_choice", optionIds: ["a"], otherText: "x" },
      ["choice/other-text-without-other"],
    ],
    ["number integer", questions.number({ numberKind: "integer" }), { type: "number", value: "72" }, []],
    ["number integer with a fraction", questions.number({ numberKind: "integer" }), { type: "number", value: "72.5" }, ["number/not-integer"]],
    ["number integer written with a zero fraction", questions.number({ numberKind: "integer" }), { type: "number", value: "72.0" }, []],
    ["number integer with a non-zero fraction after zeros", questions.number({ numberKind: "integer" }), { type: "number", value: "72.0001" }, ["number/not-integer"]],
    ["number max compared exactly, not after rounding", questions.number({ max: 72.5 }), { type: "number", value: "72.5000000000000001" }, ["number/out-of-range"]],
    ["number float", questions.number(), { type: "number", value: "72.5" }, []],
    ["number at the inclusive bounds", questions.number({ min: 0.5, max: 250 }), { type: "number", value: "250.00" }, []],
    ["number below min", questions.number({ min: 0.5 }), { type: "number", value: "0.49" }, ["number/out-of-range"]],
    ["number above max", questions.number({ max: 250 }), { type: "number", value: "250.01" }, ["number/out-of-range"]],
    ["date within absolute bounds", questions.date({ min: "1900-01-01", max: "2026-12-31" }), { type: "date", date: "1985-06-15" }, []],
    ["date before min", questions.date({ min: "1900-01-01" }), { type: "date", date: "1899-12-31" }, ["date/out-of-range"]],
    ["date after max", questions.date({ max: "2026-12-31" }), { type: "date", date: "2027-01-01" }, ["date/out-of-range"]],
    ["not_future today", questions.date({ relative: "not_future" }), { type: "date", date: "2026-09-13" }, []],
    ["not_future tomorrow", questions.date({ relative: "not_future" }), { type: "date", date: "2026-09-14" }, ["date/in-future"]],
    ["not_past today", questions.date({ relative: "not_past" }), { type: "date", date: "2026-09-13" }, []],
    ["not_past yesterday", questions.date({ relative: "not_past" }), { type: "date", date: "2026-09-12" }, ["date/in-past"]],
    ["an answer shaped for another type", questions.date(), { type: "text", text: "2020-01-01" }, ["answer/type-mismatch"]],
  ])("%s", (_, question, answer, expected) => {
    expect(codesFor(question, answer)).toEqual(expected);
  });
});

describe("validateSubmission — the server's authority over the reachable path", () => {
  const v1 = intakeDefinition(1);
  const yes: ClientAnswerValue = { type: "single_choice", optionId: "yes" };
  const no: ClientAnswerValue = { type: "single_choice", optionId: "no" };
  const pharmacy: ClientAnswerValue = { type: "text", text: "Boots, High Street" };

  it("accepts the yes path and returns one row per answer in item order, carrying the pinned question version", () => {
    const result = validateSubmission(
      v1,
      {
        itm_04: pharmacy,
        itm_03: { type: "date", date: "2019-04-02" },
        itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" },
        itm_01: yes,
      },
      DATES,
    );
    expect(result).toEqual({
      valid: true,
      rows: [
        { itemId: "itm_01", questionId: INTAKE_QUESTION_IDS.hasCondition, questionVersion: 1, type: "single_choice", optionIds: ["yes"] },
        {
          itemId: "itm_02",
          questionId: INTAKE_QUESTION_IDS.whichCondition,
          questionVersion: 3,
          type: "single_choice",
          optionIds: ["other"],
          otherText: "Asthma",
        },
        { itemId: "itm_03", questionId: INTAKE_QUESTION_IDS.diagnosedOn, questionVersion: 1, type: "date", date: "2019-04-02" },
        { itemId: "itm_04", questionId: INTAKE_QUESTION_IDS.pharmacy, questionVersion: 1, type: "text", text: "Boots, High Street" },
      ],
    });
    if (result.valid) for (const row of result.rows) expect(Value.Check(ResponseRow, row)).toBe(true);
  });

  it("accepts the no path, where the branch items are not required", () => {
    expect(validateSubmission(v1, { itm_01: no, itm_02: null, itm_04: pharmacy }, DATES)).toMatchObject({ valid: true });
  });

  it("requires every visible required item", () => {
    expect(validateSubmission(v1, { itm_01: yes, itm_04: pharmacy }, DATES)).toEqual({
      valid: false,
      items: [
        { itemId: "itm_02", code: "answer/required" },
        { itemId: "itm_03", code: "answer/required" },
      ],
    });
  });

  it("rejects an answer to a skipped item rather than ignoring it, naming the item and never the value", () => {
    const result = validateSubmission(
      v1,
      { itm_01: no, itm_02: { type: "single_choice", optionId: "opt_diabetes" }, itm_03: { type: "date", date: "2019-04-02" }, itm_04: pharmacy },
      DATES,
    );
    expect(result).toEqual({
      valid: false,
      items: [
        { itemId: "itm_02", code: "answer/not-visible" },
        { itemId: "itm_03", code: "answer/not-visible" },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/2019-04-02|opt_diabetes/);
  });

  it("rejects answers keyed by an itemId the pinned version does not have", () => {
    expect(validateSubmission(v1, { itm_01: no, itm_04: pharmacy, itm_99: pharmacy, itm_98: null }, DATES)).toEqual({
      valid: false,
      items: [{ itemId: "itm_99", code: "answer/unknown-item" }],
    });
  });

  it("is all-or-nothing: one invalid answer yields no rows", () => {
    const result = validateSubmission(v1, { itm_01: no, itm_04: { type: "text", text: "x".repeat(121) } }, DATES);
    expect(result).toEqual({ valid: false, items: [{ itemId: "itm_04", code: "text/too-long" }] });
  });

  it("rejects duplicate option ids and names the item (#34)", () => {
    const definition = aDefinition([anItem("itm_symptoms", questions.multiple(), { required: true })]);
    expect(validateSubmission(definition, { itm_symptoms: { type: "multiple_choice", optionIds: ["b", "a", "b"] } }, DATES)).toEqual({
      valid: false,
      items: [{ itemId: "itm_symptoms", code: "choice/duplicate-option" }],
    });
  });

  it("fills the unit from the pinned question version and never from the client (#42)", () => {
    const definition = aDefinition([
      anItem("itm_height", questions.number({ unit: "cm" }), { required: true }),
      anItem("itm_count", questions.number({ numberKind: "integer" })),
    ]);
    const result = validateSubmission(
      definition,
      { itm_height: { type: "number", value: "180.5" }, itm_count: { type: "number", value: "3" } },
      DATES,
    );
    expect(result).toMatchObject({
      valid: true,
      rows: [
        { itemId: "itm_height", type: "number", number: "180.5", unit: "cm" },
        { itemId: "itm_count", type: "number", number: "3" },
      ],
    });
    if (result.valid) expect(result.rows[1]).not.toHaveProperty("unit");
  });

  it.each([
    ["72.50", "float", "72.5"],
    ["72.500", "float", "72.5"],
    ["72.0", "integer", "72"],
    ["-0", "integer", "0"],
    ["-0.0", "float", "0"],
    ["-12.340", "float", "-12.34"],
  ] as const)("stores the canonical decimal: %s on a %s question → %s", (value, numberKind, stored) => {
    const definition = aDefinition([anItem("itm_n", questions.number({ numberKind }), { required: true })]);
    const result = validateSubmission(definition, { itm_n: { type: "number", value } }, DATES);
    expect(result).toMatchObject({ valid: true, rows: [{ itemId: "itm_n", type: "number", number: stored }] });
  });

  it("keeps a single_choice as a one-element optionIds array, matching the column", () => {
    const result = validateSubmission(v1, { itm_01: no, itm_04: pharmacy }, DATES);
    expect(result.valid && result.rows[0]).toMatchObject({ optionIds: ["no"] });
  });

  describe("the predicate-change fixture: same answers, opposite outcomes, decided by the pinned version", () => {
    const tightened = intakeDefinition(2);
    tightened.items[2]!.visibleWhen = all(
      { type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" },
      { type: "single_choice", itemId: "itm_02", op: "isNot", optionId: "other" },
    );
    const answers: ClientAnswers = {
      itm_01: yes,
      itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" },
      itm_03: { type: "date", date: "2019-04-02" },
      itm_04: pharmacy,
    };

    it("accepts under v1, where the diagnosis date is on the path", () => {
      expect(validateSubmission(v1, answers, DATES).valid).toBe(true);
    });

    it("rejects under the tightened v2, naming itm_03", () => {
      expect(validateSubmission(tightened, answers, DATES)).toEqual({
        valid: false,
        items: [{ itemId: "itm_03", code: "answer/not-visible" }],
      });
    });
  });
});
