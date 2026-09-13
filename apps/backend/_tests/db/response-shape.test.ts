import type pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { aPublishedQuestionnaire, aSession, insertResponse, type PublishedFixture, type ResponseValues } from "./fixtures.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

let execution: pg.Client;
let published: PublishedFixture;
let sessionId: string;

beforeEach(async () => {
  published = await aPublishedQuestionnaire(testDatabase.database("definition"));
  execution = await testDatabase.connect("execution");
  sessionId = await aSession(execution, published);
});

const validShapes: [string, ResponseValues][] = [
  ["text", { question_type: "text", text_value: "Boots on Main St" }],
  ["number with its unit", { question_type: "number", number_value: "182.5", number_unit: "cm" }],
  ["number without a unit", { question_type: "number", number_value: "3" }],
  ["date", { question_type: "date", date_value: "2019-04-02" }],
  ["single choice", { question_type: "single_choice", option_ids: ["opt_diabetes"] }],
  ["single choice of other with its text", { question_type: "single_choice", option_ids: ["other"], other_text: "Asthma" }],
  ["multiple choice", { question_type: "multiple_choice", option_ids: ["opt_diabetes", "opt_hyperten"] }],
];

const invalidShapes: [string, ResponseValues][] = [
  ["single choice with no option array", { question_type: "single_choice", option_ids: null }],
  ["multiple choice with no option array", { question_type: "multiple_choice", option_ids: null }],
  ["single choice holding a NULL element", { question_type: "single_choice", option_ids: [null] }],
  ["multiple choice holding a NULL element", { question_type: "multiple_choice", option_ids: ["opt_diabetes", null] }],
  ["text that is empty", { question_type: "text", text_value: "" }],
  ["text with no value", { question_type: "text" }],
  ["single choice with two options", { question_type: "single_choice", option_ids: ["yes", "no"] }],
  ["multiple choice with an empty array", { question_type: "multiple_choice", option_ids: [] }],
  ["number with no value", { question_type: "number", number_unit: "cm" }],
  ["date with no value", { question_type: "date" }],
  ["text also carrying a number", { question_type: "text", text_value: "x", number_value: "1" }],
  ["date also carrying options", { question_type: "date", date_value: "2019-04-02", option_ids: ["yes"] }],
  ["other text without the other option", { question_type: "single_choice", option_ids: ["yes"], other_text: "Asthma" }],
  ["a removed yes_no type", { question_type: "yes_no", option_ids: ["yes"] }],
  ["an unknown type", { question_type: "rating", number_value: "4" }],
];

describe("response_shape", () => {
  it.each(validShapes)("accepts a %s", async (_label, values) => {
    const inserted = await insertResponse(execution, published, sessionId, values);
    expect(inserted.rowCount).toBe(1);
  });

  it.each(invalidShapes)("rejects a %s", async (_label, values) => {
    await expectSqlState(insertResponse(execution, published, sessionId, values), SQLSTATE.checkViolation);
  });

  it("accepts duplicate ids inside a multiple choice answer, which the submit validator owns (#34)", async () => {
    const inserted = await insertResponse(execution, published, sessionId, {
      question_type: "multiple_choice",
      option_ids: ["opt_diabetes", "opt_diabetes"],
    });
    expect(inserted.rowCount).toBe(1);
  });
});
