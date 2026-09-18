import { DRAFT_ITEM_CODES, type DraftItem, type DraftItemCode, type QuestionVersion, type QuestionnaireDraft } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { DRAFT_ITEM_MESSAGES } from "../../../src/screens/draft-editor/draft-item-messages";
import { QUESTIONNAIRE_ID, VERSION_ID, aQuestionVersion } from "../../support/builders";

const uuid = (n: number) => `01a0950e-56a0-73d6-b936-4a1e10eff${String(n).padStart(3, "0")}`;

const smoke = aQuestionVersion({
  type: "single_choice",
  questionId: uuid(1),
  questionVersion: 2,
  prompt: "Do you smoke?",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
});
const perDay = aQuestionVersion({ type: "number", questionId: uuid(2), questionVersion: 1, prompt: "How many a day?" });
const quit = aQuestionVersion({ type: "text", questionId: uuid(3), questionVersion: 1, prompt: "Have you tried to quit?" });

function placed(itemId: string, question: QuestionVersion, visibleWhen: DraftItem["visibleWhen"] = null): DraftItem {
  return { itemId, required: true, visibleWhen, questionId: question.questionId, questionVersion: question.questionVersion };
}

function draftOf(items: DraftItem[], questions: QuestionVersion[] = [smoke, perDay, quit]): QuestionnaireDraft {
  return { questionnaireId: QUESTIONNAIRE_ID, versionId: VERSION_ID, title: "Smoking", updatedAt: "2026-09-14T09:00:00.000Z", items, questions };
}

function explain(code: DraftItemCode, draft: QuestionnaireDraft, itemId: string) {
  const index = draft.items.findIndex((item) => item.itemId === itemId);
  const item = draft.items[index];
  if (item === undefined) throw new Error(`no item ${itemId}`);
  const { detail, fix } = DRAFT_ITEM_MESSAGES[code].explain({ draft, item, position: index + 1 });
  return `${detail} ${fix}`;
}

const isYes = { type: "single_choice", itemId: "itm_smoke", op: "is", optionId: "yes" } as const;
const perDayOver = (itemId: string) => ({ type: "number", itemId, op: "gt", value: 5 }) as const;

describe("the draft-item message catalogue", () => {
  it("has a title and an explanation for every code, and opens Rules exactly for the rule codes and unreachable", () => {
    const draft = draftOf([placed("itm_smoke", smoke)]);
    const opening = DRAFT_ITEM_CODES.filter((code) => DRAFT_ITEM_MESSAGES[code].opensRules);
    expect(opening.toSorted()).toEqual(
      [
        "draft/unreachable",
        "predicate/forward-reference",
        "predicate/type-mismatch",
        "predicate/unknown-item",
        "predicate/unknown-option",
        "predicate/unsatisfiable",
      ].toSorted(),
    );
    for (const code of DRAFT_ITEM_CODES) {
      expect(DRAFT_ITEM_MESSAGES[code].title).toMatch(/^[A-Z][^.]+$/);
      expect(explain(code, draft, "itm_smoke")).not.toContain(code);
    }
  });

  it("names the later question a condition reads, or says the condition reads its own question", () => {
    const later = draftOf([placed("itm_per_day", perDay, { all: [isYes] }), placed("itm_smoke", smoke)]);
    expect(explain("predicate/forward-reference", later, "itm_per_day")).toBe(
      "A condition reads the answer to question 2, which now comes after this one. Rules can only use questions above. Move question 2 above this one, or change the condition in Rules.",
    );

    const two = draftOf([
      placed("itm_quit", quit, { all: [isYes, perDayOver("itm_per_day")] }),
      placed("itm_smoke", smoke),
      placed("itm_per_day", perDay),
    ]);
    expect(explain("predicate/forward-reference", two, "itm_quit")).toBe(
      "Conditions read the answers to questions 2 and 3, which now come after this one. Rules can only use questions above. Move questions 2 and 3 above this one, or change the conditions in Rules.",
    );

    const self = draftOf([placed("itm_smoke", smoke, { all: [isYes] })]);
    expect(explain("predicate/forward-reference", self, "itm_smoke")).toBe(
      "A condition reads this question's own answer. Rules can only use questions above. Remove that condition in Rules.",
    );

    const gone = draftOf([placed("itm_smoke", smoke)]);
    expect(explain("predicate/forward-reference", gone, "itm_smoke")).toMatch(/^A condition reads a question that comes after this one\./);
  });

  it("names the question and pinned version whose option a condition uses, without the option id", () => {
    const draft = draftOf([
      placed("itm_smoke", smoke),
      placed("itm_per_day", perDay, { all: [{ type: "single_choice", itemId: "itm_smoke", op: "isAnyOf", optionIds: ["yes", "sometimes"] }] }),
    ]);
    const text = explain("predicate/unknown-option", draft, "itm_per_day");
    expect(text).toBe(
      "A condition on question 1, “Do you smoke?”, uses an option that its version 2 no longer has. Choose one of its current options in Rules, or remove the condition.",
    );
    expect(text).not.toContain("sometimes");
    expect(explain("predicate/unknown-option", draftOf([placed("itm_smoke", smoke)]), "itm_smoke")).toMatch(
      /^A condition uses an answer option that its question no longer has\./,
    );
  });

  it("names both response types for a type mismatch, with the labels the type pills use", () => {
    const draft = draftOf([placed("itm_per_day", perDay), placed("itm_quit", quit, { all: [{ ...isYes, itemId: "itm_per_day" }] })]);
    expect(explain("predicate/type-mismatch", draft, "itm_quit")).toBe(
      "A condition on question 1 was written for a Single choice question, but question 1 is a Number question. Remove that condition in Rules and add it again.",
    );
  });

  it("tells all from any for unsatisfiable rules, and names the questions an unreachable one reads", () => {
    const all = draftOf([placed("itm_smoke", smoke), placed("itm_quit", quit, { all: [isYes] })]);
    const any = draftOf([placed("itm_smoke", smoke), placed("itm_quit", quit, { any: [isYes] })]);
    expect(explain("predicate/unsatisfiable", all, "itm_quit")).toMatch(/^No set of answers makes all of its conditions true/);
    expect(explain("predicate/unsatisfiable", any, "itm_quit")).toMatch(/^None of its conditions can ever be true/);

    const unreachable = draftOf([
      placed("itm_smoke", smoke),
      placed("itm_per_day", perDay, { all: [isYes] }),
      placed("itm_quit", quit, { all: [isYes, perDayOver("itm_per_day")] }),
    ]);
    expect(explain("draft/unreachable", unreachable, "itm_quit")).toBe(
      "Its rules can be met on their own, but not together with the rules that decide when questions 1 and 2 are shown. No respondent will see it. Review the rules here and on questions 1 and 2.",
    );
  });

  it("points a duplicate at the first placement, and gives the missing version's number", () => {
    const draft = draftOf([placed("itm_smoke", smoke), placed("itm_quit", quit), placed("itm_smoke_again", smoke)]);
    expect(explain("draft/duplicate-question", draft, "itm_smoke_again")).toBe(
      "“Do you smoke?” is also question 1. A question can appear only once in a questionnaire, so each respondent's answer is counted once. Remove one of them. If other questions' rules read this one, point them at question 1 first.",
    );
    const missing = draftOf([{ ...placed("itm_smoke", smoke), questionVersion: 9 }]);
    expect(explain("draft/question-version-unknown", missing, "itm_smoke")).toBe(
      "This entry uses version 9 of a question, and that version does not exist. Remove it, then add the question again from the bank.",
    );
  });

  it("describes an archived question as one that cannot be placed, not as a draft that cannot be saved", () => {
    const text = explain("draft/question-archived", draftOf([placed("itm_smoke", smoke)]), "itm_smoke");
    expect(text).toContain("“Do you smoke?” was archived in the question bank");
    expect(text).not.toMatch(/saved/);
  });
});
