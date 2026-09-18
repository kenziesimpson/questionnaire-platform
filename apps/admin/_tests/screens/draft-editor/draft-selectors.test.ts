import type { QuestionVersion, QuestionnaireDraft } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { earlierItemsThan, laterReferencesIn, referenceOf } from "../../../src/screens/draft-editor/draft-selectors";
import { QUESTIONNAIRE_ID, VERSION_ID, aQuestionVersion, uuid } from "../../support/builders";

const questions: Record<QuestionVersion["type"], QuestionVersion> = {
  text: aQuestionVersion({ type: "text", questionId: uuid(1), questionVersion: 1 }),
  single_choice: aQuestionVersion({ type: "single_choice", questionId: uuid(2), questionVersion: 1 }),
  multiple_choice: aQuestionVersion({ type: "multiple_choice", questionId: uuid(3), questionVersion: 1 }),
  number: aQuestionVersion({ type: "number", questionId: uuid(4), questionVersion: 1, min: 18 }),
  date: aQuestionVersion({ type: "date", questionId: uuid(5), questionVersion: 1, max: "2026-09-01" }),
};

function draftOf(types: QuestionVersion["type"][]): QuestionnaireDraft {
  return {
    questionnaireId: QUESTIONNAIRE_ID,
    versionId: VERSION_ID,
    title: "Rules",
    updatedAt: "2026-09-14T09:00:00.000Z",
    items: types.map((type, index) => ({
      itemId: `itm_0${index + 1}`,
      required: true,
      visibleWhen: null,
      questionId: questions[type].questionId,
      questionVersion: 1,
    })),
    questions: Object.values(questions),
  };
}

describe("draft selectors", () => {
  it("offers only items above the dependant, and tells an earlier reference from a later, a missing and a mistyped one", () => {
    const draft = draftOf(["single_choice", "number", "text"]);
    expect(earlierItemsThan(draft, "itm_03").map(({ item }) => item.itemId)).toEqual(["itm_01", "itm_02"]);
    expect(earlierItemsThan(draft, "itm_01")).toEqual([]);

    const isYes = { type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" } as const;
    expect(referenceOf(draft, "itm_02", isYes)).toMatchObject({ kind: "earlier", position: 1 });
    expect(referenceOf(draft, "itm_01", isYes)).toMatchObject({ kind: "later", position: 1 });
    expect(referenceOf(draft, "itm_02", { ...isYes, itemId: "itm_09" })).toEqual({ kind: "unusable", reason: "missing", position: null });
    expect(referenceOf(draft, "itm_03", { type: "text", itemId: "itm_02", op: "answered", value: true })).toMatchObject({
      kind: "unusable",
      reason: "type-mismatch",
    });

    const [first, second, third] = draft.items;
    if (!first || !second || !third) throw new Error("fixture");
    const reordered = { ...draft, items: [{ ...second, visibleWhen: { all: [isYes] } }, first, third] };
    expect(laterReferencesIn(reordered, reordered.items[0] ?? second)).toEqual([2]);
  });
});
