import type { DraftItem, QuestionInput } from "@qp/shared";
import { describe, expect, it } from "vitest";
import type { Database } from "../../../src/db/client.js";
import type { DraftPrecondition } from "../../../src/db/definition/draft-precondition.js";
import { withLockedQuestionnaire } from "../../../src/db/definition/questionnaire-rows.js";
import { createNextDraft, replaceDraft, validateOpenDraft } from "../../../src/db/definition/drafts.js";
import { createQuestionnaire } from "../../../src/db/definition/questionnaires.js";
import { appendQuestionVersion, createQuestion } from "../../../src/db/definition/questions.js";
import {
  actor,
  aDraftWithOneItem,
  aPublishedQuestionnaire,
  aTextQuestion,
  publishSavedDraft,
  saveDraft,
  QUESTIONNAIRE_LOCK_STATEMENT,
  theStatementWaitingOnALock,
  whileHoldingALock,
} from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();

const yesNo: QuestionInput = {
  type: "single_choice",
  prompt: "Do you have a medical condition?",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
};

function itemFor(itemId: string, questionId: string): DraftItem {
  return { itemId, required: false, visibleWhen: null, questionId, questionVersion: 1 };
}

async function archive(questionId: string): Promise<void> {
  const client = await testDatabase.connect("definition");
  await client.query(`UPDATE definition.question SET archived_at = now() WHERE id = $1`, [questionId]);
}

interface PlacedArchivedQuestions {
  readonly questionnaireId: string;
  readonly precondition: DraftPrecondition;
  readonly items: readonly DraftItem[];
}

async function aDraftPlacingTwoQuestionsLaterArchived(db: Database): Promise<PlacedArchivedQuestions> {
  const choice = await createQuestion(db, { key: null, content: yesNo, ...actor });
  const firstArchived = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
  const secondArchived = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
  const created = await createQuestionnaire(db, {
    key: null,
    name: "Archived later",
    title: "Archived later",
    createdBy: "test",
    traceId: null,
  });
  const items = [
    itemFor("itm_01", choice.questionId),
    itemFor("itm_02", firstArchived.questionId),
    itemFor("itm_03", secondArchived.questionId),
  ];
  const precondition = await saveDraft(
    db,
    created.questionnaireId,
    { versionId: created.draftVersionId, draftRevision: created.draftRevision },
    "Archived later",
    items,
  );
  await archive(firstArchived.questionId);
  await archive(secondArchived.questionId);
  return { questionnaireId: created.questionnaireId, precondition, items };
}

async function draftItems(draftVersionId: string) {
  const client = await testDatabase.connect("definition");
  const rows = await client.query<{ item_id: string; position: number }>(
    `SELECT item_id, position FROM definition.questionnaire_item WHERE questionnaire_version_id = $1 ORDER BY position`,
    [draftVersionId],
  );
  return rows.rows;
}

describe("replaceDraft", () => {
  it("removes, reorders and adds items, renames the draft, bumps the revision and audits the edit", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const second = await createQuestion(definitionDb, { key: null, content: aTextQuestion, ...actor });
    const third = await createQuestion(definitionDb, { key: null, content: aTextQuestion, ...actor });
    const withThree = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      title: "Fixture",
      items: [itemFor("itm_01", draft.questionId), itemFor("itm_02", second.questionId), itemFor("itm_03", third.questionId)],
      actorId: "author-1",
      traceId: null,
    });
    if (withThree.outcome !== "saved") {
      throw new Error(withThree.outcome);
    }

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: withThree.draftRevision },
      title: "Renamed",
      items: [itemFor("itm_03", third.questionId), itemFor("itm_01", draft.questionId)],
      actorId: "author-1",
      traceId: null,
    });

    expect(outcome).toMatchObject({ outcome: "saved", draftVersionId: draft.draftVersionId, draftRevision: withThree.draftRevision + 1 });
    expect(await draftItems(draft.draftVersionId)).toEqual([
      { item_id: "itm_03", position: 0 },
      { item_id: "itm_01", position: 1 },
    ]);
    const client = await testDatabase.connect("definition");
    const version = await client.query(`SELECT title FROM definition.questionnaire_version WHERE id = $1`, [draft.draftVersionId]);
    expect(version.rows[0].title).toBe("Renamed");
    expect((await testDatabase.readAuditEvents()).filter((event) => event.action === "edit_draft")).toHaveLength(3);
  });

  it("empties a draft", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      title: "Fixture",
      items: [],
      actorId: null,
      traceId: null,
    });

    expect(outcome.outcome).toBe("saved");
    expect(await draftItems(draft.draftVersionId)).toEqual([]);
  });

  it("refuses a stale revision and leaves the items untouched", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision - 1 },
      title: "Fixture",
      items: [],
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "stale" });
    expect(await draftItems(draft.draftVersionId)).toEqual([{ item_id: "itm_01", position: 0 }]);
  });

  it("finds no draft to replace once the questionnaire is published", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: published.questionnaireId,
      precondition: { versionId: published.draftVersionId, draftRevision: published.draftRevision },
      title: "Fixture",
      items: [],
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "no-draft" });
    expect(await draftItems(published.draftVersionId)).toEqual([{ item_id: "itm_01", position: 0 }]);
  });

  it("rejects an archived question and a question version that does not exist, writing nothing", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const archived = await createQuestion(definitionDb, { key: null, content: aTextQuestion, ...actor });
    const client = await testDatabase.connect("definition");
    await client.query(`UPDATE definition.question SET archived_at = now() WHERE id = $1`, [archived.questionId]);

    const archivedOutcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      title: "Fixture",
      items: [itemFor("itm_02", archived.questionId)],
      actorId: null,
      traceId: null,
    });
    const unknownOutcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      title: "Fixture",
      items: [{ ...itemFor("itm_01", draft.questionId), questionVersion: 9 }],
      actorId: null,
      traceId: null,
    });

    expect(archivedOutcome).toEqual({ outcome: "invalid", items: [{ itemId: "itm_02", code: "draft/question-archived" }] });
    expect(unknownOutcome).toEqual({ outcome: "invalid", items: [{ itemId: "itm_01", code: "draft/question-version-unknown" }] });
    expect(await draftItems(draft.draftVersionId)).toEqual([{ item_id: "itm_01", position: 0 }]);
  });

  it("reports only duplicated item ids when the same draft also places an archived question and an unknown version", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const archived = await createQuestion(definitionDb, { key: null, content: aTextQuestion, ...actor });
    const client = await testDatabase.connect("definition");
    await client.query(`UPDATE definition.question SET archived_at = now() WHERE id = $1`, [archived.questionId]);

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      title: "Fixture",
      items: [
        itemFor("itm_02", archived.questionId),
        itemFor("itm_02", draft.questionId),
        { ...itemFor("itm_03", draft.questionId), questionVersion: 9 },
      ],
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "invalid", items: [{ itemId: "itm_02", code: "draft/duplicate-item-id" }] });
    expect(await draftItems(draft.draftVersionId)).toEqual([{ item_id: "itm_01", position: 0 }]);
  });

  it("reports archived placements before unknown versions, naming every item that places an archived question in request order", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const archived = await createQuestion(definitionDb, { key: null, content: aTextQuestion, ...actor });
    const client = await testDatabase.connect("definition");
    await client.query(`UPDATE definition.question SET archived_at = now() WHERE id = $1`, [archived.questionId]);

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      title: "Fixture",
      items: [
        itemFor("itm_03", archived.questionId),
        { ...itemFor("itm_01", draft.questionId), questionVersion: 9 },
        itemFor("itm_02", archived.questionId),
      ],
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({
      outcome: "invalid",
      items: [
        { itemId: "itm_03", code: "draft/question-archived" },
        { itemId: "itm_02", code: "draft/question-archived" },
      ],
    });
  });
});

describe("replaceDraft when a placed question has since been archived", () => {
  it("saves a retitle, a reorder and an edit to another item's predicate without refusing the existing archived placements", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftPlacingTwoQuestionsLaterArchived(definitionDb);
    const [choice, firstArchived, secondArchived] = draft.items;
    if (choice === undefined || firstArchived === undefined || secondArchived === undefined) {
      throw new Error("fixture placed fewer than three items");
    }

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: draft.precondition,
      title: "Retitled",
      items: [
        choice,
        secondArchived,
        { ...firstArchived, visibleWhen: { all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] } },
      ],
      actorId: null,
      traceId: null,
    });

    expect(outcome).toMatchObject({ outcome: "saved", draftRevision: draft.precondition.draftRevision + 1 });
    expect(await draftItems(draft.precondition.versionId)).toEqual([
      { item_id: "itm_01", position: 0 },
      { item_id: "itm_03", position: 1 },
      { item_id: "itm_02", position: 2 },
    ]);
    expect(await validateOpenDraft(definitionDb, draft.questionnaireId)).toEqual({ valid: true, items: [] });
  });

  it("saves the removal of one of two existing archived placements", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftPlacingTwoQuestionsLaterArchived(definitionDb);

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: draft.precondition,
      title: "Archived later",
      items: draft.items.filter((item) => item.itemId !== "itm_02"),
      actorId: null,
      traceId: null,
    });

    expect(outcome.outcome).toBe("saved");
    expect(await draftItems(draft.precondition.versionId)).toEqual([
      { item_id: "itm_01", position: 0 },
      { item_id: "itm_03", position: 1 },
    ]);
  });

  it("refuses a new archived placement alongside existing ones, naming only the new item and writing nothing", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftPlacingTwoQuestionsLaterArchived(definitionDb);
    const added = await createQuestion(definitionDb, { key: null, content: aTextQuestion, ...actor });
    await archive(added.questionId);

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: draft.precondition,
      title: "Archived later",
      items: [...draft.items, itemFor("itm_04", added.questionId)],
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "invalid", items: [{ itemId: "itm_04", code: "draft/question-archived" }] });
    expect(await draftItems(draft.precondition.versionId)).toEqual([
      { item_id: "itm_01", position: 0 },
      { item_id: "itm_02", position: 1 },
      { item_id: "itm_03", position: 2 },
    ]);
  });

  it("refuses an archived question placed again after its item was removed in an earlier save", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftPlacingTwoQuestionsLaterArchived(definitionDb);
    const removed = await saveDraft(
      definitionDb,
      draft.questionnaireId,
      draft.precondition,
      "Archived later",
      draft.items.filter((item) => item.itemId !== "itm_02"),
    );

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: removed,
      title: "Archived later",
      items: draft.items,
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "invalid", items: [{ itemId: "itm_02", code: "draft/question-archived" }] });
  });

  it("refuses re-pinning an existing archived placement to a newer version, since that version pair is a new placement", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftPlacingTwoQuestionsLaterArchived(definitionDb);
    const [choice, firstArchived, secondArchived] = draft.items;
    if (choice === undefined || firstArchived === undefined || secondArchived === undefined) {
      throw new Error("fixture placed fewer than three items");
    }
    await appendQuestionVersion(definitionDb, {
      questionId: firstArchived.questionId,
      content: { ...aTextQuestion, prompt: "Edited while archived" },
      createdBy: "test",
      traceId: null,
    });

    const outcome = await replaceDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: draft.precondition,
      title: "Archived later",
      items: [choice, { ...firstArchived, questionVersion: 2 }, secondArchived],
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "invalid", items: [{ itemId: "itm_02", code: "draft/question-archived" }] });
  });
});

describe("createNextDraft", () => {
  it("waits on the questionnaire lock, as its first statement, while another transaction holds it", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);
    const events: string[] = [];
    let creating: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      definitionDb,
      (tx) => withLockedQuestionnaire(tx, published.questionnaireId, async () => undefined),
      async () => {
        creating = createNextDraft(definitionDb, { questionnaireId: published.questionnaireId, createdBy: null, traceId: null }).then(
          (outcome) => events.push(`createNextDraft returned ${outcome.outcome}`),
        );
        expect(await theStatementWaitingOnALock(testDatabase)).toMatch(QUESTIONNAIRE_LOCK_STATEMENT);
        events.push("lock holder commits");
      },
    );
    await creating;

    expect(events).toEqual(["lock holder commits", "createNextDraft returned created"]);
  });

  it("opens a next draft copying a since-archived question that then saves, validates and publishes", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);
    const other = await createQuestion(definitionDb, { key: null, content: aTextQuestion, ...actor });
    await archive(published.questionId);

    const opened = await createNextDraft(definitionDb, { questionnaireId: published.questionnaireId, createdBy: null, traceId: null });
    if (opened.outcome !== "created") {
      throw new Error(opened.outcome);
    }
    const precondition = await saveDraft(
      definitionDb,
      published.questionnaireId,
      { versionId: opened.draft.versionId, draftRevision: opened.draftRevision },
      "Second edition",
      [itemFor("itm_02", other.questionId), ...opened.draft.items],
    );

    expect(await validateOpenDraft(definitionDb, published.questionnaireId)).toEqual({ valid: true, items: [] });
    expect(await publishSavedDraft(definitionDb, published.questionnaireId, precondition)).toBe(2);
  });
});
