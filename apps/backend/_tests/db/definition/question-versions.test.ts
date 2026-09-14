import type { DraftItem, QuestionInput } from "@qp/shared";
import { describe, expect, it } from "vitest";
import type { Database } from "../../../src/db/client.js";
import { createQuestionnaire, replaceDraft } from "../../../src/db/definition/drafts.js";
import { appendQuestionVersion, createQuestion } from "../../../src/db/definition/questions.js";
import {
  pinnedByDraft,
  questionVersionIn,
  questionVersionKey,
  readOptionsInPosition,
  readQuestionVersions,
} from "../../../src/db/definition/question-versions.js";
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

const recoloured: QuestionInput = {
  type: "single_choice",
  prompt: "Favourite colour?",
  options: [
    { optionId: "blue", label: "Blue" },
    { optionId: "red", label: "Red" },
    { optionId: "yellow", label: "Yellow" },
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

describe("readQuestionVersions", () => {
  it("loads exactly the versions a draft pins, each with its own options in position order", async () => {
    const db = testDatabase.database("definition");
    const choice = await createQuestion(db, { key: null, content: colours, ...actor });
    await appendQuestionVersion(db, { questionId: choice.questionId, content: recoloured, ...actor });
    const text = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const draftVersionId = await aDraftPlacing(db, [placement("itm_01", choice.questionId, 2), placement("itm_02", text.questionId, 1)]);
    await aDraftPlacing(db, [placement("itm_01", choice.questionId, 1)]);

    const pinned = await readQuestionVersions(db, pinnedByDraft(draftVersionId));

    expect([...pinned.keys()].sort()).toEqual(
      [questionVersionKey({ questionId: choice.questionId, version: 2 }), questionVersionKey({ questionId: text.questionId, version: 1 })].sort(),
    );
    expect(pinned.get(questionVersionKey({ questionId: choice.questionId, version: 2 }))?.options.map((o) => o.optionId)).toEqual([
      "blue",
      "red",
      "yellow",
    ]);
    expect(pinned.get(questionVersionKey({ questionId: text.questionId, version: 1 }))?.options).toEqual([]);
  });

  it("loads named versions, and nothing at all for an empty list", async () => {
    const db = testDatabase.database("definition");
    const choice = await createQuestion(db, { key: null, content: colours, ...actor });
    await appendQuestionVersion(db, { questionId: choice.questionId, content: recoloured, ...actor });

    const first = await readQuestionVersions(db, questionVersionIn([{ questionId: choice.questionId, version: 1 }]));

    expect([...first.values()].map((loaded) => loaded.options.map((o) => o.optionId))).toEqual([["red", "green"]]);
    expect(await readQuestionVersions(db, questionVersionIn([]))).toEqual(new Map());
    expect(await readOptionsInPosition(db, questionVersionIn([]))).toEqual(new Map());
  });
});
