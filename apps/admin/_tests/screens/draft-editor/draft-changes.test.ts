import { SLUG_PATTERN, type DraftItem, type QuestionnaireDraft } from "@qp/shared";
import { describe, expect, it } from "vitest";
import {
  addItem,
  dependantsOf,
  generateItemId,
  moveItem,
  removeItem,
  repinItem,
  setRequired,
} from "../../../src/screens/draft-editor/draft-changes";
import { aDraft, aQuestionVersion } from "../../support/builders";

const OTHER_QUESTION_ID = "01a0950e-56a0-73d6-b936-4a1e10eff9a0";

function ids(draft: QuestionnaireDraft) {
  return draft.items.map(({ itemId }) => itemId);
}

function conditionedOn(item: DraftItem, ...itemIds: string[]): DraftItem {
  return {
    ...item,
    visibleWhen: { any: itemIds.map((itemId) => ({ type: "text" as const, itemId, op: "answered" as const, value: true })) },
  };
}

describe("draft changes", () => {
  it("generates itm_ ids matching the slug pattern and draws again on a taken one", () => {
    const suffixes = ["taken001", "fresh002"];
    const id = generateItemId(new Set(["itm_taken001"]), () => suffixes.shift() ?? "");
    expect(id).toBe("itm_fresh002");
    expect(generateItemId(new Set())).toMatch(new RegExp(SLUG_PATTERN));
  });

  it("adds an item pinned to exactly the version given, required, always shown, and carries that version in questions", () => {
    const shown = aQuestionVersion({ type: "text", questionId: OTHER_QUESTION_ID, questionVersion: 4, prompt: "Pharmacy" });
    const next = addItem(shown, () => "added01x")(aDraft(["itm_01"]));
    expect(next.items.at(-1)).toEqual({
      itemId: "itm_added01x",
      required: true,
      visibleWhen: null,
      questionId: OTHER_QUESTION_ID,
      questionVersion: 4,
    });
    expect(next.questions).toContainEqual(shown);
  });

  it("moves an item to an index and ignores a move out of range", () => {
    const draft = aDraft(["itm_01", "itm_02", "itm_03"]);
    expect(ids(moveItem("itm_01", 2)(draft))).toEqual(["itm_02", "itm_03", "itm_01"]);
    expect(ids(moveItem("itm_03", 0)(draft))).toEqual(["itm_03", "itm_01", "itm_02"]);
    expect(moveItem("itm_01", 3)(draft)).toBe(draft);
  });

  it("removes an item with the conditions that referenced it, clearing a group left empty", () => {
    const draft = aDraft(["itm_01", "itm_02", "itm_03", "itm_04"]);
    const [first, second, third, fourth] = draft.items;
    if (!first || !second || !third || !fourth) throw new Error("fixture");
    const withRules = { ...draft, items: [first, second, conditionedOn(third, "itm_01"), conditionedOn(fourth, "itm_01", "itm_02")] };

    expect(dependantsOf(withRules, "itm_01").map(({ itemId }) => itemId)).toEqual(["itm_03", "itm_04"]);
    const next = removeItem("itm_01")(withRules);
    expect(ids(next)).toEqual(["itm_02", "itm_03", "itm_04"]);
    expect(next.items[1]?.visibleWhen).toBeNull();
    expect(next.items[2]?.visibleWhen).toEqual({ any: [{ type: "text", itemId: "itm_02", op: "answered", value: true }] });
  });

  it("re-pins only the named item, only for its own question, and sets required per item", () => {
    const draft = aDraft(["itm_01", "itm_02"]);
    const [first] = draft.items;
    if (!first) throw new Error("fixture");
    const saved = aQuestionVersion({ type: "text", questionId: first.questionId, questionVersion: 7 });
    const next = repinItem("itm_01", saved)(draft);
    expect(next.items.map(({ questionVersion }) => questionVersion)).toEqual([7, 1]);
    expect(next.questions).toContainEqual(saved);
    expect(repinItem("itm_01", { ...saved, questionId: OTHER_QUESTION_ID })(draft).items[0]?.questionVersion).toBe(1);
    expect(setRequired("itm_02", false)(draft).items.map(({ required }) => required)).toEqual([true, false]);
  });
});
