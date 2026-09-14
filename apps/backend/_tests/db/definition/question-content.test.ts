import type { QuestionInput } from "@qp/shared";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import {
  questionInputToColumns,
  storedQuestionToContent,
  storedQuestionToVersion,
  type QuestionVersionColumns,
  type StoredOption,
} from "../../../src/db/definition/question-content.js";

const splits: [string, QuestionInput, QuestionVersionColumns][] = [
  [
    "text",
    { type: "text", prompt: "Anything else?", minLength: 1, maxLength: 200, multiline: true },
    { type: "text", prompt: "Anything else?", constraints: { minLength: 1, maxLength: 200, multiline: true }, options: [] },
  ],
  [
    "single_choice",
    { type: "single_choice", prompt: "Pick one", options: [{ optionId: "yes", label: "Yes" }, { optionId: "no", label: "No" }] },
    { type: "single_choice", prompt: "Pick one", constraints: {}, options: [{ optionId: "yes", label: "Yes" }, { optionId: "no", label: "No" }] },
  ],
  [
    "multiple_choice",
    {
      type: "multiple_choice",
      prompt: "Symptoms",
      options: [{ optionId: "opt_cough", label: "Cough" }, { optionId: "other", label: "Other", freeform: true }],
      minSelections: 1,
      maxSelections: 2,
    },
    {
      type: "multiple_choice",
      prompt: "Symptoms",
      constraints: { minSelections: 1, maxSelections: 2 },
      options: [{ optionId: "opt_cough", label: "Cough" }, { optionId: "other", label: "Other", freeform: true }],
    },
  ],
  [
    "number",
    { type: "number", prompt: "Weight", numberKind: "float", min: 0, max: 500, unit: "kg" },
    { type: "number", prompt: "Weight", constraints: { numberKind: "float", min: 0, max: 500, unit: "kg" }, options: [] },
  ],
  [
    "date",
    { type: "date", prompt: "Diagnosed on", min: "1900-01-01", relative: "not_future" },
    { type: "date", prompt: "Diagnosed on", constraints: { min: "1900-01-01", relative: "not_future" }, options: [] },
  ],
];

function storedOptionsOf(columns: QuestionVersionColumns): StoredOption[] {
  return columns.options.map((option) => ({ optionId: option.optionId, label: option.label, freeform: option.freeform ?? false }));
}

describe("questionInputToColumns", () => {
  it.each(splits)("splits a %s question into type, prompt, constraints and options", (_type, input, columns) => {
    expect(questionInputToColumns(input)).toEqual(columns);
  });
});

describe("storedQuestionToContent", () => {
  it.each(splits)("round-trips a %s question from input to columns and back to content", (_type, input) => {
    const questionId = uuidv7();
    const columns = questionInputToColumns(input);

    const content = storedQuestionToContent(
      { questionId, version: 3, type: columns.type, prompt: columns.prompt, constraints: columns.constraints },
      storedOptionsOf(columns),
    );

    expect(content).toStrictEqual({ ...input, questionId, questionVersion: 3 });
  });

  it("carries options only on choice types, whatever options it is handed", () => {
    const stray: StoredOption[] = [{ optionId: "yes", label: "Yes", freeform: false }];
    const stored = { questionId: uuidv7(), version: 1, prompt: "Prompt", constraints: {} };

    const text = storedQuestionToContent({ ...stored, type: "text" }, stray);
    const single = storedQuestionToContent({ ...stored, type: "single_choice" }, stray);

    expect(text).not.toHaveProperty("options");
    expect(single).toHaveProperty("options", [{ optionId: "yes", label: "Yes" }]);
  });

  it("keeps freeform only on the option where it was set", () => {
    const content = storedQuestionToContent({ questionId: uuidv7(), version: 1, type: "multiple_choice", prompt: "Symptoms", constraints: {} }, [
      { optionId: "opt_cough", label: "Cough", freeform: false },
      { optionId: "other", label: "Other", freeform: true },
    ]);

    expect(content).toHaveProperty("options", [{ optionId: "opt_cough", label: "Cough" }, { optionId: "other", label: "Other", freeform: true }]);
    expect(content.type === "multiple_choice" ? content.options[0] : undefined).not.toHaveProperty("freeform");
  });
});

describe("storedQuestionToVersion", () => {
  it("adds the version's creation time as ISO 8601 and its author to the content", () => {
    const questionId = uuidv7();
    const createdAt = new Date("2026-09-14T10:00:00.000Z");

    const version = storedQuestionToVersion(
      { questionId, version: 2, type: "text", prompt: "Anything else?", constraints: {}, createdAt, createdBy: "author-1" },
      [],
    );

    expect(version).toStrictEqual({
      questionId,
      questionVersion: 2,
      type: "text",
      prompt: "Anything else?",
      createdAt: "2026-09-14T10:00:00.000Z",
      createdBy: "author-1",
    });
  });
});
