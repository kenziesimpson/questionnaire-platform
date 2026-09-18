import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { intakeDefinition } from "../../src/demo/intake.js";
import { DraftItem, draftForValidation, draftItemOf } from "../../src/domain/draft.js";
import { validateDraft } from "../../src/engine/draft-validation.js";

describe("draftItemOf", () => {
  it("places the same question version, with the same placement, by reference instead of inline", () => {
    for (const item of intakeDefinition(1).items) {
      const draftItem = draftItemOf(item);
      expect(draftItem).toEqual({
        itemId: item.itemId,
        required: item.required,
        visibleWhen: item.visibleWhen,
        questionId: item.question.questionId,
        questionVersion: item.question.questionVersion,
      });
      expect(Value.Check(DraftItem, draftItem)).toBe(true);
    }
  });
});

describe("draftForValidation", () => {
  it("carries every item by reference and every pinned question version once per item, so a published definition validates as a draft", () => {
    const { items } = intakeDefinition(2);
    const draft = draftForValidation(items);
    expect(draft.items).toEqual(items.map(draftItemOf));
    expect(draft.questions).toEqual(items.map((item) => item.question));
    expect(draft.archivedQuestionIds).toBeUndefined();
    expect(validateDraft(draft)).toEqual({ valid: true, items: [] });
  });
});
