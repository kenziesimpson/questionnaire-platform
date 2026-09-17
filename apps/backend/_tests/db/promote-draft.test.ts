import { FORMAT_VERSION } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { aDraftWithOneItem, aPublishedQuestionnaire, type DraftFixture } from "./fixtures.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

function snapshotFor(draft: DraftFixture, overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: FORMAT_VERSION,
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
    ...overrides,
  };
}

const promote = `SELECT definition.promote_draft($1, $2::jsonb) AS version`;

async function publicationState(draft: DraftFixture) {
  const owner = await testDatabase.connect("owner");
  const version = await owner.query(`SELECT status FROM definition.questionnaire_version WHERE id = $1`, [draft.draftVersionId]);
  const pointer = await owner.query(`SELECT current_version_id FROM definition.questionnaire WHERE id = $1`, [draft.questionnaireId]);
  const index = await owner.query(`SELECT count(*)::int AS n FROM definition.version_question_index WHERE questionnaire_version_id = $1`, [
    draft.draftVersionId,
  ]);
  const publishEvents = (await testDatabase.readAuditEvents()).filter((event) => event.action === "publish").length;
  return {
    status: version.rows[0].status,
    pointer: pointer.rows[0].current_version_id,
    indexRows: index.rows[0].n,
    publishEvents,
  };
}

describe("publishing outside promote_draft", () => {
  it("denies qp_definition the forged single-UPDATE promotion", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(
        `UPDATE definition.questionnaire_version
            SET status = 'published', version = 1, snapshot = '{"forged":true}'::jsonb, format_version = 1, published_at = now()
          WHERE id = $1`,
        [draft.draftVersionId],
      ),
      SQLSTATE.insufficientPrivilege,
    );
    expect(await publicationState(draft)).toEqual({ status: "draft", pointer: null, indexRows: 0, publishEvents: 0 });
  });

  it("denies qp_definition moving the current-version pointer directly", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(`UPDATE definition.questionnaire SET current_version_id = NULL, current_version = NULL WHERE id = $1`, [
        published.questionnaireId,
      ]),
      SQLSTATE.insufficientPrivilege,
    );
  });

  it("leaves qp_definition UPDATE only on the draft-editing columns", async () => {
    const owner = await testDatabase.connect("owner");
    const columns = await owner.query<{ relation: string; column: string }>(
      `SELECT c.table_name AS relation, c.column_name AS column
         FROM information_schema.columns c
        WHERE c.table_schema = 'definition' AND c.table_name IN ('questionnaire', 'questionnaire_version')
          AND has_column_privilege('qp_definition', format('definition.%I', c.table_name), c.column_name, 'UPDATE')
        ORDER BY c.table_name, c.column_name`,
    );
    expect(columns.rows).toEqual([
      { relation: "questionnaire", column: "closes_at" },
      { relation: "questionnaire", column: "key" },
      { relation: "questionnaire", column: "name" },
      { relation: "questionnaire_version", column: "draft_revision" },
      { relation: "questionnaire_version", column: "title" },
      { relation: "questionnaire_version", column: "updated_at" },
    ]);
  });
});

describe("definition.promote_draft", () => {
  it("promotes, indexes and moves the pointer in one call, and writes no audit row, which publishDraft owns", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    const promoted = await definition.query(promote, [draft.draftVersionId, JSON.stringify(snapshotFor(draft))]);

    expect(promoted.rows[0].version).toBe(1);
    expect(await publicationState(draft)).toEqual({
      status: "published",
      pointer: draft.draftVersionId,
      indexRows: 1,
      publishEvents: 0,
    });
  });

  it("rejects a version that is already published with QP001", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(promote, [published.draftVersionId, JSON.stringify(snapshotFor(published))]),
      SQLSTATE.immutable,
    );
  });

  it.each([
    ["names the wrong version", { version: 7 }],
    ["names another questionnaire", { questionnaireId: "01a09c50-0000-7000-8000-00000000ffff" }],
    ["lists items the draft does not have", { items: [] }],
  ])("rejects a snapshot that %s and writes nothing", async (_label, overrides) => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(promote, [draft.draftVersionId, JSON.stringify(snapshotFor(draft, overrides))]),
      "22023",
    );
    expect(await publicationState(draft)).toEqual({ status: "draft", pointer: null, indexRows: 0, publishEvents: 0 });
  });

  it("cannot be called by qp_execution", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");

    await expectSqlState(
      execution.query(promote, [draft.draftVersionId, JSON.stringify(snapshotFor(draft))]),
      SQLSTATE.insufficientPrivilege,
    );
  });

  it("is SECURITY DEFINER with a pinned search_path and EXECUTE for qp_definition only", async () => {
    const owner = await testDatabase.connect("owner");
    const fn = await owner.query(
      `SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
              has_function_privilege('qp_definition', p.oid, 'EXECUTE') AS definition_can_execute,
              has_function_privilege('qp_execution', p.oid, 'EXECUTE') AS execution_can_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'definition' AND p.proname = 'promote_draft'`,
    );
    expect(fn.rows).toEqual([
      {
        prosecdef: true,
        proconfig: ["search_path=definition, pg_temp"],
        owner: "qp_owner",
        definition_can_execute: true,
        execution_can_execute: false,
      },
    ]);
  });
});
