import type { ResponseRow } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { answersFromResponseRows, responseRowsBySession } from "../../../src/db/reporting/responses.js";
import { aPublishedQuestionnaire, aSession, insertResponse, useTestDatabase, type ResponseValues } from "../fixtures.js";

const testDatabase = useTestDatabase();

describe("responseRowsBySession", () => {
  it("keys the read on the session's submittedAt as well as its id, so it stays inside one partition", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const sessionId = await aSession(execution, published);
    const submittedAt = new Date("2026-10-15T12:00:00.000Z");
    await insertResponse(execution, published, sessionId, { question_type: "text", text_value: "stored in October" }, submittedAt);
    const reporting = testDatabase.database("reporting");

    const matching = await responseRowsBySession(reporting, [{ id: sessionId, submittedAt }]);
    const otherMonth = await responseRowsBySession(reporting, [{ id: sessionId, submittedAt: new Date("2026-11-15T12:00:00.000Z") }]);

    expect(matching.get(sessionId)).toHaveLength(1);
    expect(otherMonth.size).toBe(0);
  });

  it("issues no query for an empty page", async () => {
    expect((await responseRowsBySession(testDatabase.database("reporting"), [])).size).toBe(0);
  });
});

describe("responseRowsBySession rows", () => {
  const submittedAt = new Date("2026-10-15T12:00:00.000Z");

  async function readBack(values: ResponseValues) {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const sessionId = await aSession(execution, published);
    await insertResponse(execution, published, sessionId, values, submittedAt);
    const rows = (await responseRowsBySession(testDatabase.database("reporting"), [{ id: sessionId, submittedAt }])).get(sessionId);
    return { rows, published };
  }

  it.each<[string, ResponseValues, object]>([
    ["text", { question_type: "text", text_value: "Corner Pharmacy" }, { type: "text", text: "Corner Pharmacy" }],
    ["number with a unit", { question_type: "number", number_value: "72.5", number_unit: "kg" }, { type: "number", number: "72.5", unit: "kg" }],
    ["number without a unit", { question_type: "number", number_value: "72" }, { type: "number", number: "72" }],
    ["date", { question_type: "date", date_value: "2020-02-29" }, { type: "date", date: "2020-02-29" }],
    ["single choice", { question_type: "single_choice", option_ids: ["opt_a"] }, { type: "single_choice", optionIds: ["opt_a"] }],
    [
      "single choice with other text",
      { question_type: "single_choice", option_ids: ["other"], other_text: "Long COVID" },
      { type: "single_choice", optionIds: ["other"], otherText: "Long COVID" },
    ],
    [
      "multiple choice, in stored order",
      { question_type: "multiple_choice", option_ids: ["opt_b", "opt_a"] },
      { type: "multiple_choice", optionIds: ["opt_b", "opt_a"] },
    ],
  ])("rebuilds a %s answer with no key for a value that was not stored", async (_, values, expected) => {
    const { rows, published } = await readBack(values);

    expect(rows).toEqual([{ itemId: "itm_01", questionId: published.questionId, questionVersion: 1, ...expected }]);
  });

  it("groups rows by session across the sessions of one page", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const first = await aSession(execution, published);
    const second = await aSession(execution, published);
    await insertResponse(execution, published, first, { question_type: "text", text_value: "first" }, submittedAt);
    await insertResponse(execution, published, second, { question_type: "text", text_value: "second" }, submittedAt);

    const grouped = await responseRowsBySession(testDatabase.database("reporting"), [
      { id: first, submittedAt },
      { id: second, submittedAt },
    ]);

    expect(grouped.get(first)).toMatchObject([{ text: "first" }]);
    expect(grouped.get(second)).toMatchObject([{ text: "second" }]);
  });
});

describe("answersFromResponseRows", () => {
  const head = { questionId: "01a0950f-4100-7fcc-8acc-05dc6b75ce33", questionVersion: 1 };

  it("turns each stored row into the client answer for its item, keyed by itemId", () => {
    const rows: ResponseRow[] = [
      { ...head, itemId: "itm_01", type: "text", text: "hello" },
      { ...head, itemId: "itm_02", type: "single_choice", optionIds: ["yes"] },
      { ...head, itemId: "itm_03", type: "multiple_choice", optionIds: ["a", "b"], otherText: "more" },
      { ...head, itemId: "itm_04", type: "number", number: "72.5", unit: "kg" },
      { ...head, itemId: "itm_05", type: "date", date: "2020-02-29" },
    ];

    expect(answersFromResponseRows(rows)).toEqual({
      itm_01: { type: "text", text: "hello" },
      itm_02: { type: "single_choice", optionId: "yes" },
      itm_03: { type: "multiple_choice", optionIds: ["a", "b"], otherText: "more" },
      itm_04: { type: "number", value: "72.5" },
      itm_05: { type: "date", date: "2020-02-29" },
    });
  });

  it("carries the other text of a single choice, and leaves the key off when there is none", () => {
    const withOther = answersFromResponseRows([{ ...head, itemId: "itm_01", type: "single_choice", optionIds: ["other"], otherText: "Long COVID" }]);
    const without = answersFromResponseRows([{ ...head, itemId: "itm_01", type: "single_choice", optionIds: ["other"] }]);

    expect(withOther.itm_01).toEqual({ type: "single_choice", optionId: "other", otherText: "Long COVID" });
    expect(Object.keys(without.itm_01 ?? {})).toEqual(["type", "optionId"]);
  });

  it("does not copy the array of a multiple choice, so a caller cannot change the stored row through it", () => {
    const optionIds = ["a", "b"];

    const answers = answersFromResponseRows([{ ...head, itemId: "itm_01", type: "multiple_choice", optionIds }]);

    const answer = answers.itm_01;
    if (answer?.type !== "multiple_choice") throw new Error("expected a multiple choice answer");
    expect(answer.optionIds).toEqual(["a", "b"]);
    expect(answer.optionIds).not.toBe(optionIds);
  });

  it("answers an empty record for no rows", () => {
    expect(answersFromResponseRows([])).toEqual({});
  });
});
