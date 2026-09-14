import type { DraftItem, QuestionInput } from "@qp/shared";
import { describe, expect, it } from "vitest";
import type { Database } from "../../../src/db/client.js";
import {
  itemsWithQuestionContent,
  pinnedQuestionVersionsInPlacementOrder,
  readDraftContents,
} from "../../../src/db/definition/draft-contents.js";
import { replaceDraft } from "../../../src/db/definition/drafts.js";
import { createQuestionnaire } from "../../../src/db/definition/questionnaires.js";
import { createQuestion } from "../../../src/db/definition/questions.js";
import { aTextQuestion } from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();
const actor = { createdBy: "test", traceId: null };

const colours: QuestionInput = {
  type: "single_choice",
  prompt: "Favourite colour?",
  options: [
    { optionId: "red", label: "Red" },
    { optionId: "green", label: "Green" },
  ],
};

function placement(itemId: string, questionId: string, questionVersion: number): DraftItem {
  return { itemId, required: false, visibleWhen: null, questionId, questionVersion };
}

async function aDraftPlacing(db: Database, items: DraftItem[]): Promise<string> {
  const created = await createQuestionnaire(db, { key: null, name: "Loader", title: "Loader", ...actor });
  const saved = await replaceDraft(db, {
    questionnaireId: created.questionnaireId,
    precondition: { versionId: created.draftVersionId, draftRevision: created.draftRevision },
    title: "Loader",
    items,
    actorId: "test",
    traceId: null,
  });
  if (saved.outcome !== "saved") {
    throw new Error(`draft was not saved: ${saved.outcome}`);
  }
  return created.draftVersionId;
}

describe("readDraftContents", () => {
  it("lists a question version placed twice once, in first-placement order, while every item keeps its content", async () => {
    const db = testDatabase.database("definition");
    const choice = await createQuestion(db, { key: null, content: colours, ...actor });
    const text = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const draftVersionId = await aDraftPlacing(db, [
      placement("itm_01", text.questionId, 1),
      placement("itm_02", choice.questionId, 1),
      placement("itm_03", text.questionId, 1),
    ]);

    const contents = await readDraftContents(db, draftVersionId);

    expect(pinnedQuestionVersionsInPlacementOrder(contents).map((q) => q.questionId)).toEqual([text.questionId, choice.questionId]);
    expect(itemsWithQuestionContent(contents).map((item) => [item.itemId, item.question.questionId])).toEqual([
      ["itm_01", text.questionId],
      ["itm_02", choice.questionId],
      ["itm_03", text.questionId],
    ]);
  });
});
