import { describe, expect, it } from "vitest";
import { publishDraft } from "../../../src/db/definition/publish.js";
import { acceptAll, aDraftWithOneItem, aPublishedQuestionnaire } from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();

describe("publishDraft", () => {
  it("promotes the draft in place, writes the reverse index, moves the pointer and audits in one transaction", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);

    const outcome = await publishDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      expectedDraftRevision: draft.draftRevision,
      rules: acceptAll,
      actorId: "author-1",
      traceId: "trace-1",
    });

    expect(outcome).toMatchObject({ outcome: "published", questionnaireVersionId: draft.draftVersionId, version: 1 });
    const client = await testDatabase.connect("definition");
    const version = await client.query(
      `SELECT status, version, format_version, snapshot, published_at IS NOT NULL AS stamped
         FROM definition.questionnaire_version WHERE id = $1`,
      [draft.draftVersionId],
    );
    expect(version.rows[0]).toMatchObject({ status: "published", version: 1, format_version: 1, stamped: true });
    expect(version.rows[0].snapshot).toEqual({
      formatVersion: 1,
      questionnaireId: draft.questionnaireId,
      version: 1,
      title: "Fixture",
      items: [
        {
          itemId: "itm_01",
          required: true,
          visibleWhen: null,
          question: { questionId: draft.questionId, questionVersion: 1, type: "text", prompt: "Anything else?" },
        },
      ],
    });
    const pointer = await client.query(`SELECT current_version_id, current_version FROM definition.questionnaire WHERE id = $1`, [
      draft.questionnaireId,
    ]);
    expect(pointer.rows[0]).toEqual({ current_version_id: draft.draftVersionId, current_version: 1 });
    const index = await client.query(
      `SELECT question_id, question_version FROM definition.version_question_index WHERE questionnaire_version_id = $1`,
      [draft.draftVersionId],
    );
    expect(index.rows).toEqual([{ question_id: draft.questionId, question_version: 1 }]);
    const events = await testDatabase.readAuditEvents();
    expect(events.at(-1)).toMatchObject({
      action: "publish",
      questionnaire_id: draft.questionnaireId,
      questionnaire_version_id: draft.draftVersionId,
      version: 1,
      actor_id: "author-1",
    });
  });

  it("refuses a stale draft revision and writes nothing", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const eventsBefore = await testDatabase.readAuditEvents();

    const outcome = await publishDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      expectedDraftRevision: draft.draftRevision - 1,
      rules: acceptAll,
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "stale", draftRevision: draft.draftRevision });
    expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
  });

  it("returns the rule failures and leaves the draft, index and audit untouched", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const eventsBefore = await testDatabase.readAuditEvents();

    const outcome = await publishDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      expectedDraftRevision: draft.draftRevision,
      rules: (definition) => definition.items.map((item) => ({ itemId: item.itemId, code: "always/invalid" })),
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "invalid", failures: [{ itemId: "itm_01", code: "always/invalid" }] });
    const client = await testDatabase.connect("definition");
    const version = await client.query(`SELECT status FROM definition.questionnaire_version WHERE id = $1`, [
      draft.draftVersionId,
    ]);
    const index = await client.query(`SELECT 1 FROM definition.version_question_index WHERE questionnaire_version_id = $1`, [
      draft.draftVersionId,
    ]);
    expect(version.rows[0].status).toBe("draft");
    expect(index.rowCount).toBe(0);
    expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
  });

  it("reports no draft once the only draft has been published", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);

    const outcome = await publishDraft(definitionDb, {
      questionnaireId: published.questionnaireId,
      expectedDraftRevision: published.draftRevision,
      rules: acceptAll,
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "no-draft" });
  });

  it("lets exactly one of two concurrent publishes of the same draft win", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const command = {
      questionnaireId: draft.questionnaireId,
      expectedDraftRevision: draft.draftRevision,
      rules: acceptAll,
      actorId: null,
      traceId: null,
    };

    const outcomes = await Promise.all([publishDraft(definitionDb, command), publishDraft(definitionDb, command)]);

    expect(outcomes.map((outcome) => outcome.outcome).sort()).toEqual(["no-draft", "published"]);
  });
});
