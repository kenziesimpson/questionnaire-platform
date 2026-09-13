import { describe, expect, it } from "vitest";
import type { ClientAnswerValue } from "../../src/domain/answer.js";
import type { Condition } from "../../src/domain/condition.js";
import type { QuestionContent, QuestionInput } from "../../src/domain/question.js";
import { validateAnswer } from "../../src/engine/answer-validation.js";
import { conditionHolds } from "../../src/engine/conditions.js";
import { isTermSatisfiable, termOf } from "../../src/engine/satisfiability.js";
import { anItem, questions } from "./fixtures.js";
import {
  conditions,
  day,
  decimal,
  OPERATOR_CASES,
  pick,
  picks,
  SOURCE_BY_TYPE,
  textAnswer,
  WRONG_TYPE_ANSWER,
} from "./operator-table.js";

const shownWith = (answer: ClientAnswerValue | undefined) => ({ shown: true, answer });
const hiddenWith = (answer: ClientAnswerValue | undefined) => ({ shown: false, answer });

describe("conditionHolds — every operator against every type", () => {
  it("covers every operator of every response type", () => {
    const covered = new Set(OPERATOR_CASES.map(([, condition]) => `${condition.type}.${condition.op}`));
    expect([...covered].sort()).toEqual(
      [
        "text.answered", "text.notAnswered",
        "single_choice.is", "single_choice.isNot", "single_choice.isAnyOf", "single_choice.isNoneOf",
        "multiple_choice.includes", "multiple_choice.excludes", "multiple_choice.includesAnyOf", "multiple_choice.includesAllOf",
        "number.eq", "number.neq", "number.lt", "number.lte", "number.gt", "number.gte", "number.between",
        "date.before", "date.onOrBefore", "date.after", "date.onOrAfter", "date.between",
      ].sort(),
    );
  });

  it.each(OPERATOR_CASES)("%s → %s", (_, condition, answer, expected) => {
    expect(SOURCE_BY_TYPE[condition.type]).toBe(condition.itemId);
    expect(conditionHolds(condition, shownWith(answer))).toBe(expected);
  });
});

describe("conditionHolds — a condition on a question that was not answered or not shown is false", () => {
  const exceptNotAnswered = OPERATOR_CASES.filter(([, condition]) => condition.op !== "notAnswered");

  it.each(exceptNotAnswered)("unanswered: %s → false", (_, condition) => {
    expect(conditionHolds(condition, shownWith(undefined))).toBe(false);
  });

  it.each(OPERATOR_CASES)("not shown, answer kept: %s → false", (_, condition, answer) => {
    expect(conditionHolds(condition, hiddenWith(answer))).toBe(false);
  });

  it.each(OPERATOR_CASES)("answer shaped for another type: %s → false", (_, condition) => {
    expect(conditionHolds(condition, shownWith(WRONG_TYPE_ANSWER[condition.type]))).toBe(false);
  });

  it("negative operators do not fire for a respondent who never answered (the SQL NULL trap)", () => {
    const negatives = [
      conditions.single("isNot", "a"),
      conditions.singleList("isNoneOf", ["a"]),
      conditions.multi("excludes", "a"),
      conditions.num("neq", 1),
    ];
    for (const condition of negatives) expect(conditionHolds(condition, shownWith(undefined))).toBe(false);
  });

  it("text notAnswered holds only while the referenced item is shown and unanswered", () => {
    const notAnswered = conditions.text("notAnswered");
    expect(conditionHolds(notAnswered, shownWith(undefined))).toBe(true);
    expect(conditionHolds(notAnswered, hiddenWith(undefined))).toBe(false);
    expect(conditionHolds(notAnswered, shownWith(textAnswer("x")))).toBe(false);
  });
});

describe("holds implies satisfiable — the runtime and publish-time encodings of operator meaning agree", () => {
  const DATES = { today: "2026-09-13", toleranceDays: 0 };
  const content = (question: QuestionInput) => anItem("src", question).question as QuestionContent;

  const multipleChoiceSubsets = (["a", "b", "c", "other"] as const)
    .reduce<string[][]>((subsets, id) => [...subsets, ...subsets.map((subset) => [...subset, id])], [[]])
    .filter((subset) => subset.length > 0)
    .map((subset): ClientAnswerValue => ({ ...picks(...subset), ...(subset.includes("other") ? { otherText: "x" } : {}) }) as ClientAnswerValue);

  const CANDIDATES: Record<Condition["type"], (ClientAnswerValue | undefined)[]> = {
    text: [undefined, textAnswer("Boots"), textAnswer("x")],
    single_choice: [pick("a"), pick("b"), pick("c"), { type: "single_choice", optionId: "other", otherText: "x" }],
    multiple_choice: multipleChoiceSubsets,
    number: ["-3", "0", "0.00000005", "0.00000011", "0.1", "1", "1.5", "2", "2.5", "17.9", "17.99", "18", "18.01", "18.5", "19", "100", "1000000000000000000001"].map(decimal),
    date: ["2019-12-31", "2020-01-01", "2020-01-02", "2020-06-15", "2020-12-31", "2021-01-01"].map(day),
  };

  const QUESTIONS: [label: string, question: QuestionContent, everyConditionCanHold: boolean][] = [
    ["text", content(questions.text()), true],
    ["text, maxLength 3", content(questions.text({ maxLength: 3 })), false],
    ["single_choice", content(questions.single()), true],
    ["multiple_choice", content(questions.multiple()), true],
    ["multiple_choice, maxSelections 1", content(questions.multiple({ maxSelections: 1 })), false],
    ["number, float", content(questions.number()), true],
    ["number, integer 0..100", content(questions.number({ numberKind: "integer", min: 0, max: 100 })), false],
    ["date", content(questions.date()), true],
    ["date, 2020 only", content(questions.date({ min: "2020-01-01", max: "2020-12-31" })), false],
  ];

  const distinctConditions = [...new Map(OPERATOR_CASES.map(([, condition]) => [JSON.stringify(condition), condition])).values()];

  it.each(QUESTIONS)("on a %s question", (_, question, everyConditionCanHold) => {
    const validCandidates = CANDIDATES[question.type].filter(
      (answer) => answer === undefined || validateAnswer(question, answer, DATES).length === 0,
    );
    for (const condition of distinctConditions.filter((c) => c.type === question.type)) {
      const holdsForSomeAnswer = validCandidates.some((answer) => conditionHolds(condition, shownWith(answer)));
      if (everyConditionCanHold) expect(holdsForSomeAnswer, JSON.stringify(condition)).toBe(true);
      if (holdsForSomeAnswer) {
        expect(isTermSatisfiable(termOf([condition]), () => question), JSON.stringify(condition)).toBe(true);
      }
    }
  });
});
