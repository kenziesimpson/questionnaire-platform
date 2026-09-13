import { describe, expect, it } from "vitest";
import { aDraftWithOneItem, aPublishedQuestionnaire } from "./fixtures.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

describe("published questionnaire versions", () => {
  it("reject UPDATE of the snapshot, bypassing the API", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(`UPDATE definition.questionnaire_version SET snapshot = '{}'::jsonb WHERE id = $1`, [
        published.draftVersionId,
      ]),
      SQLSTATE.immutable,
    );
  });

  it("reject UPDATE even from the owner role", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const owner = await testDatabase.connect("owner");

    await expectSqlState(
      owner.query(`UPDATE definition.questionnaire_version SET title = 'Rewritten' WHERE id = $1`, [
        published.draftVersionId,
      ]),
      SQLSTATE.immutable,
    );
  });

  it("reject DELETE", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const owner = await testDatabase.connect("owner");

    await expectSqlState(
      owner.query(`DELETE FROM definition.questionnaire_version WHERE id = $1`, [published.draftVersionId]),
      SQLSTATE.immutable,
    );
  });

  it("reject demotion back to draft", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(
        `UPDATE definition.questionnaire_version
            SET status = 'draft', version = NULL, snapshot = NULL, format_version = NULL, published_at = NULL
          WHERE id = $1`,
        [published.draftVersionId],
      ),
      SQLSTATE.immutable,
    );
  });

  it("leave drafts editable", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    const updated = await definition.query(
      `UPDATE definition.questionnaire_version SET title = 'Renamed' WHERE id = $1`,
      [draft.draftVersionId],
    );

    expect(updated.rowCount).toBe(1);
  });

  it("cannot be inserted already published without a snapshot", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(
        `INSERT INTO definition.questionnaire_version (id, questionnaire_id, status, title)
         VALUES (gen_random_uuid(), $1, 'published', 'Shortcut')`,
        [draft.questionnaireId],
      ),
      SQLSTATE.checkViolation,
    );
  });
});

describe("question versions", () => {
  it("reject UPDATE and DELETE on versions", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const owner = await testDatabase.connect("owner");

    await expectSqlState(
      owner.query(`UPDATE definition.question_version SET prompt = 'Changed' WHERE question_id = $1`, [
        published.questionId,
      ]),
      SQLSTATE.immutable,
    );
    await expectSqlState(
      owner.query(`DELETE FROM definition.question_version WHERE question_id = $1`, [published.questionId]),
      SQLSTATE.immutable,
    );
  });

  it("reject UPDATE and DELETE on options, even for a question no questionnaire uses", async () => {
    const definition = await testDatabase.connect("definition");
    const owner = await testDatabase.connect("owner");
    const questionId = "01a09c50-0000-7000-8000-000000000001";
    await definition.query(`INSERT INTO definition.question (id) VALUES ($1)`, [questionId]);
    await definition.query(
      `INSERT INTO definition.question_version (question_id, version, type, prompt) VALUES ($1, 1, 'single_choice', 'Pick')`,
      [questionId],
    );
    await definition.query(
      `INSERT INTO definition.question_version_option (question_id, version, option_id, label, position)
       VALUES ($1, 1, 'yes', 'Yes', 0)`,
      [questionId],
    );

    await expectSqlState(
      owner.query(`UPDATE definition.question_version_option SET label = 'Sure' WHERE question_id = $1`, [questionId]),
      SQLSTATE.immutable,
    );
    await expectSqlState(
      owner.query(`DELETE FROM definition.question_version_option WHERE question_id = $1`, [questionId]),
      SQLSTATE.immutable,
    );
  });
});

describe("questionnaire items", () => {
  it("reject INSERT, UPDATE and DELETE once the parent version is published", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const owner = await testDatabase.connect("owner");

    await expectSqlState(
      owner.query(
        `INSERT INTO definition.questionnaire_item (questionnaire_version_id, item_id, position, question_id, question_version)
         VALUES ($1, 'itm_02', 1, $2, 1)`,
        [published.draftVersionId, published.questionId],
      ),
      SQLSTATE.immutable,
    );
    await expectSqlState(
      owner.query(`UPDATE definition.questionnaire_item SET required = false WHERE questionnaire_version_id = $1`, [
        published.draftVersionId,
      ]),
      SQLSTATE.immutable,
    );
    await expectSqlState(
      owner.query(`DELETE FROM definition.questionnaire_item WHERE questionnaire_version_id = $1`, [
        published.draftVersionId,
      ]),
      SQLSTATE.immutable,
    );
  });

  it("cannot be reparented out of a published version into a draft", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);
    const draft = await aDraftWithOneItem(definitionDb);
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(
        `UPDATE definition.questionnaire_item SET questionnaire_version_id = $1, item_id = 'itm_moved'
          WHERE questionnaire_version_id = $2`,
        [draft.draftVersionId, published.draftVersionId],
      ),
      SQLSTATE.immutable,
    );
  });

  it("stay editable while the parent is a draft", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    const updated = await definition.query(
      `UPDATE definition.questionnaire_item SET required = false WHERE questionnaire_version_id = $1`,
      [draft.draftVersionId],
    );

    expect(updated.rowCount).toBe(1);
  });

  it("block an insert racing an uncommitted publish, then reject it once the publish commits", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const publisher = await testDatabase.connect("definition");
    const editor = await testDatabase.connect("definition");

    await publisher.query("BEGIN");
    await publisher.query(`SELECT id FROM definition.questionnaire WHERE id = $1 FOR UPDATE`, [draft.questionnaireId]);
    await publisher.query(`SELECT id FROM definition.questionnaire_version WHERE id = $1 FOR UPDATE`, [
      draft.draftVersionId,
    ]);
    await publisher.query(
      `UPDATE definition.questionnaire_version
          SET status = 'published', version = 1, snapshot = '{}'::jsonb, format_version = 1, published_at = now()
        WHERE id = $1 AND status = 'draft'`,
      [draft.draftVersionId],
    );

    let settled = false;
    const racingInsert = editor
      .query(
        `INSERT INTO definition.questionnaire_item (questionnaire_version_id, item_id, position, question_id, question_version)
         VALUES ($1, 'itm_late', 1, $2, 1)`,
        [draft.draftVersionId, draft.questionId],
      )
      .finally(() => {
        settled = true;
      });
    const outcome = expectSqlState(racingInsert, SQLSTATE.immutable);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);

    await publisher.query("COMMIT");
    await outcome;

    const items = await publisher.query(
      `SELECT count(*)::int AS n FROM definition.questionnaire_item WHERE questionnaire_version_id = $1`,
      [draft.draftVersionId],
    );
    expect(items.rows[0].n).toBe(1);
  });
});
