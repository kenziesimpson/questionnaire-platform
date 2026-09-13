import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ClientAnswerValue, ClientAnswers, ResponseRow } from "../../src/domain/answer.js";
import { Condition, Predicate, type ConditionOf } from "../../src/domain/condition.js";
import { PublishedDefinition } from "../../src/domain/definition.js";
import { QuestionInput } from "../../src/domain/question.js";

/**
 * The worked example from [[5-questionnaire-format]] §3, verbatim. Schema conformance of the documented
 * format, not the seeded demo builder — that lands with the seed and replaces nothing here.
 */
const documentedV1 = {
  formatVersion: 1,
  questionnaireId: "01a0950e-56a0-73d6-b936-4a1e10eff8c0",
  version: 1,
  title: "Patient Intake",
  items: [
    {
      itemId: "itm_01",
      required: true,
      visibleWhen: null,
      question: {
        questionId: "01a0950f-4100-7fcc-8acc-05dc6b75ce33",
        questionVersion: 1,
        type: "single_choice",
        prompt: "Do you have a medical condition?",
        options: [
          { optionId: "yes", label: "Yes" },
          { optionId: "no", label: "No" },
        ],
      },
    },
    {
      itemId: "itm_02",
      required: true,
      visibleWhen: { all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] },
      question: {
        questionId: "01a0950f-4161-7719-98fb-afa43f4c6232",
        questionVersion: 3,
        type: "single_choice",
        prompt: "Which condition?",
        options: [
          { optionId: "opt_diabetes", label: "Diabetes" },
          { optionId: "opt_hyperten", label: "Hypertension" },
          { optionId: "other", label: "Other", freeform: true },
        ],
      },
    },
    {
      itemId: "itm_03",
      required: true,
      visibleWhen: { all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] },
      question: {
        questionId: "01a0950f-41c2-7435-a65e-c53680e09195",
        questionVersion: 1,
        type: "date",
        prompt: "When were you diagnosed?",
        relative: "not_future",
      },
    },
    {
      itemId: "itm_04",
      required: true,
      visibleWhen: null,
      question: {
        questionId: "01a0950f-4223-73df-8544-fa8f63877e0b",
        questionVersion: 1,
        type: "text",
        prompt: "Preferred pharmacy",
        maxLength: 120,
      },
    },
  ],
};

const clone = <T>(v: T): T => structuredClone(v);

describe("PublishedDefinition", () => {
  it("accepts the documented version 1 snapshot", () => {
    expect(Value.Check(PublishedDefinition, documentedV1)).toBe(true);
  });

  it("accepts version 2: opt_hyperten relabelled, question version 4, nothing else changed (#26)", () => {
    const v2 = clone(documentedV1);
    v2.version = 2;
    const which = v2.items[1]!.question as { questionVersion: number; options: { optionId: string; label: string }[] };
    which.questionVersion = 4;
    which.options[1]!.label = "High blood pressure (hypertension)";
    expect(Value.Check(PublishedDefinition, v2)).toBe(true);
  });

  it.each([
    ["an unknown formatVersion", (d: any) => (d.formatVersion = 2)],
    ["a yes_no question type (#36)", (d: any) => (d.items[0].question.type = "yes_no")],
    ["a condition naming questionId instead of itemId (#41)", (d: any) => {
      d.items[1].visibleWhen.all[0] = { type: "single_choice", questionId: d.items[0].question.questionId, op: "is", optionId: "yes" };
    }],
    ["a question.key carried into the snapshot (#35)", (d: any) => (d.items[0].question.key = "qst_has_condition")],
    ["a slug questionnaireId", (d: any) => (d.questionnaireId = "qnr_intake")],
    ["a nested predicate", (d: any) => (d.items[1].visibleWhen = { all: [{ any: [] }] })],
    ["a date operator on a single_choice condition", (d: any) => (d.items[1].visibleWhen.all[0].op = "before")],
    ["a number without numberKind", (d: any) => (d.items[3].question = { ...d.items[3].question, type: "number", maxLength: undefined })],
    ["an impossible calendar date bound", (d: any) => (d.items[2].question.max = "2026-02-30")],
    ["a choice question with no options", (d: any) => (d.items[0].question.options = [])],
  ])("rejects %s", (_, mutate) => {
    const d = clone(documentedV1);
    mutate(d);
    expect(Value.Check(PublishedDefinition, d)).toBe(false);
  });
});

describe("Condition", () => {
  it.each<[string, Condition]>([
    ["text answered", { type: "text", itemId: "itm_04", op: "notAnswered" }],
    ["single_choice isAnyOf", { type: "single_choice", itemId: "itm_02", op: "isAnyOf", optionIds: ["opt_diabetes", "other"] }],
    ["multiple_choice includesAllOf", { type: "multiple_choice", itemId: "itm_05", op: "includesAllOf", optionIds: ["a", "b"] }],
    ["number gte", { type: "number", itemId: "itm_06", op: "gte", value: 18 }],
    ["number between", { type: "number", itemId: "itm_06", op: "between", min: 1.5, max: 2.5 }],
    ["date between", { type: "date", itemId: "itm_03", op: "between", min: "2000-01-01", max: "2026-09-13" }],
  ])("accepts %s", (_, condition) => {
    expect(Value.Check(Condition, condition)).toBe(true);
  });

  it.each([
    ["a text content match", { type: "text", itemId: "itm_04", op: "is", optionId: "x" }],
    ["a list operator with a single optionId", { type: "single_choice", itemId: "itm_02", op: "isAnyOf", optionId: "yes" }],
    ["a number operand as a string", { type: "number", itemId: "itm_06", op: "eq", value: "18" }],
    ["a number compared against a date", { type: "number", itemId: "itm_06", op: "before", date: "2026-01-01" }],
    ["an empty option list", { type: "multiple_choice", itemId: "itm_05", op: "includesAnyOf", optionIds: [] }],
  ])("rejects %s", (_, condition) => {
    expect(Value.Check(Condition, condition)).toBe(false);
  });

  it("allows empty groups so the engine's edge cases are expressible", () => {
    expect(Value.Check(Predicate, { all: [] })).toBe(true);
    expect(Value.Check(Predicate, { any: [] })).toBe(true);
    expect(Value.Check(Predicate, { all: [], any: [] })).toBe(false);
  });

  it("makes cross-type comparisons a compile error, not a runtime class", () => {
    // @ts-expect-error — `before` is a date operator; a number condition cannot carry it
    const numberBefore: ConditionOf<"number"> = { type: "number", itemId: "itm_06", op: "before", value: 1 };
    // @ts-expect-error — text conditions have no content-matching operators (§2.3)
    const textIs: Condition = { type: "text", itemId: "itm_04", op: "is", optionId: "x" };
    // @ts-expect-error — conditions name an itemId (#41)
    const byQuestion: Condition = { type: "text", questionId: "01a0950f-4223-73df-8544-fa8f63877e0b", op: "answered" };
    expect([numberBefore, textIs, byQuestion]).toHaveLength(3);
  });
});

describe("ClientAnswerValue and ClientAnswers on the wire", () => {
  it("carries a number as a decimal string with no unit (#42)", () => {
    expect(Value.Check(ClientAnswerValue, { type: "number", value: "72.50" })).toBe(true);
    expect(Value.Check(ClientAnswerValue, { type: "number", value: 72.5 })).toBe(false);
    expect(Value.Check(ClientAnswerValue, { type: "number", value: "72.5", unit: "kg" })).toBe(false);
  });

  it.each(["1e3", "01", "+1", "1.", ".5", "", " 1"])("rejects the non-canonical decimal %j", (value) => {
    expect(Value.Check(ClientAnswerValue, { type: "number", value })).toBe(false);
  });

  it("leaves duplicate optionIds to the submit validator's 422, not a schema 400 (#34)", () => {
    expect(Value.Check(ClientAnswerValue, { type: "multiple_choice", optionIds: ["a", "a"] })).toBe(true);
  });

  it("rejects an empty text answer, which the response shape constraint would also refuse", () => {
    expect(Value.Check(ClientAnswerValue, { type: "text", text: "" })).toBe(false);
  });

  it("keys answers by itemId, allowing explicit null as unanswered", () => {
    expect(Value.Check(ClientAnswers, { itm_01: { type: "single_choice", optionId: "yes" }, itm_04: null })).toBe(true);
    expect(Value.Check(ClientAnswers, { "01a0950f-4100-7fcc-8acc-05dc6b75ce33": { type: "text", text: "x" } })).toBe(false);
  });
});

describe("ResponseRow — the validated row the digest reads", () => {
  const head = { itemId: "itm_02", questionId: "01a0950f-4161-7719-98fb-afa43f4c6232", questionVersion: 3 };

  it("stores single_choice as a one-element optionIds array, matching the column", () => {
    expect(Value.Check(ResponseRow, { ...head, type: "single_choice", optionIds: ["other"], otherText: "Asthma" })).toBe(true);
    expect(Value.Check(ResponseRow, { ...head, type: "single_choice", optionIds: ["a", "b"] })).toBe(false);
  });

  it("carries the server-filled unit on a number row", () => {
    expect(Value.Check(ResponseRow, { ...head, type: "number", number: "180", unit: "cm" })).toBe(true);
  });
});

describe("QuestionInput", () => {
  it("accepts the yes/no editor template as a plain single_choice (#36)", () => {
    const template = {
      type: "single_choice",
      prompt: "Do you have a medical condition?",
      options: [
        { optionId: "yes", label: "True" },
        { optionId: "no", label: "False" },
      ],
    };
    expect(Value.Check(QuestionInput, template)).toBe(true);
  });

  it("does not let a save request assign identity", () => {
    expect(Value.Check(QuestionInput, { type: "text", prompt: "x", questionId: "01a0950f-4223-73df-8544-fa8f63877e0b" })).toBe(false);
  });
});
