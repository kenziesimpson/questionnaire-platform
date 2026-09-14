import type { DraftItem } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { withLockedQuestionnaire } from "../../../src/db/definition/questionnaire-rows.js";
import { openNextDraft, replaceDraft } from "../../../src/db/definition/questionnaires.js";
import { createQuestion } from "../../../src/db/definition/questions.js";
import {
  aDraftWithOneItem,
  aPublishedQuestionnaire,
  aTextQuestion,
  QUESTIONNAIRE_LOCK_STATEMENT,
  theStatementWaitingOnALock,
  whileHoldingALock,
} from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();

function itemFor(itemId: string, questionId: string): DraftItem {
  return { itemId, required: false, visibleWhen: null, questionId, questionVersion: 1 };
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
    const second = await createQuestion(definitionDb, { key: null, content: aTextQuestion, createdBy: "test", traceId: null });
    const third = await createQuestion(definitionDb, { key: null, content: aTextQuestion, createdBy: "test", traceId: null });
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
    const archived = await createQuestion(definitionDb, { key: null, content: aTextQuestion, createdBy: "test", traceId: null });
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

    expect(archivedOutcome).toEqual({ outcome: "archived-question", questionIds: [archived.questionId] });
    expect(unknownOutcome).toEqual({ outcome: "unknown-question-version", itemIds: ["itm_01"] });
    expect(await draftItems(draft.draftVersionId)).toEqual([{ item_id: "itm_01", position: 0 }]);
  });
});

describe("openNextDraft", () => {
  it("waits on the questionnaire lock, as its first statement, while another transaction holds it", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);
    const events: string[] = [];
    let opening: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      definitionDb,
      (tx) => withLockedQuestionnaire(tx, published.questionnaireId, async () => undefined),
      async () => {
        opening = openNextDraft(definitionDb, { questionnaireId: published.questionnaireId, createdBy: null, traceId: null }).then(
          (outcome) => events.push(`openNextDraft returned ${outcome.outcome}`),
        );
        expect(await theStatementWaitingOnALock(testDatabase)).toMatch(QUESTIONNAIRE_LOCK_STATEMENT);
        events.push("lock holder commits");
      },
    );
    await opening;

    expect(events).toEqual(["lock holder commits", "openNextDraft returned opened"]);
  });
});
