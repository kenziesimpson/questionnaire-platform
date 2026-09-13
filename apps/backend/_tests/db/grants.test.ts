import type pg from "pg";
import { describe, expect, it } from "vitest";
import { aPublishedQuestionnaire, aSession, insertResponse } from "./fixtures.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

const AUTHORING_TABLES = [
  "definition.question",
  "definition.question_version",
  "definition.question_version_option",
  "definition.questionnaire_item",
] as const;

const auditRecordCall = `SELECT audit.record('publish', NULL, NULL, NULL, 'intruder', NULL, NULL)`;

async function denied(client: pg.Client, statement: string, params: unknown[] = []): Promise<void> {
  await expectSqlState(client.query(statement, params), SQLSTATE.insufficientPrivilege);
}

describe("qp_execution", () => {
  it.each(AUTHORING_TABLES)("cannot read %s", async (table) => {
    const execution = await testDatabase.connect("execution");
    await denied(execution, `SELECT 1 FROM ${table} LIMIT 1`);
  });

  it("cannot write any definition table", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");

    await denied(execution, `INSERT INTO definition.question (id) VALUES (gen_random_uuid())`);
    await denied(execution, `UPDATE definition.questionnaire SET closes_at = now() WHERE id = $1`, [
      published.questionnaireId,
    ]);
    await denied(execution, `UPDATE definition.questionnaire_version SET title = 'x' WHERE id = $1`, [
      published.draftVersionId,
    ]);
    await denied(execution, `INSERT INTO definition.version_question_index SELECT * FROM definition.version_question_index`);
  });

  it("reads published versions, questionnaires and the reverse index", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");

    const snapshot = await execution.query(
      `SELECT v.snapshot FROM definition.questionnaire q
         JOIN definition.questionnaire_version v ON v.id = q.current_version_id
        WHERE q.id = $1`,
      [published.questionnaireId],
    );
    const index = await execution.query(`SELECT 1 FROM definition.version_question_index WHERE questionnaire_version_id = $1`, [
      published.draftVersionId,
    ]);

    expect(snapshot.rows[0].snapshot.questionnaireId).toBe(published.questionnaireId);
    expect(index.rowCount).toBe(1);
  });

  it("cannot UPDATE or DELETE a collected response", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const sessionId = await aSession(execution, published);
    await insertResponse(execution, published, sessionId, { question_type: "text", text_value: "original" });

    await denied(execution, `UPDATE execution.response SET text_value = 'rewritten' WHERE session_id = $1`, [sessionId]);
    await denied(execution, `DELETE FROM execution.response WHERE session_id = $1`, [sessionId]);
  });

  it("cannot DELETE a session", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const sessionId = await aSession(execution, published);

    await denied(execution, `DELETE FROM execution.session WHERE id = $1`, [sessionId]);
  });

  it("cannot reach the audit schema, even through audit.record", async () => {
    const execution = await testDatabase.connect("execution");

    await denied(execution, `SELECT 1 FROM audit.event`);
    await denied(execution, auditRecordCall);
  });
});

describe("qp_definition", () => {
  it("cannot read or write execution.response or execution.session", async () => {
    const definition = await testDatabase.connect("definition");

    await denied(definition, `SELECT 1 FROM execution.response LIMIT 1`);
    await denied(definition, `SELECT 1 FROM execution.session LIMIT 1`);
    await denied(definition, `SELECT 1 FROM execution.response_2026_09 LIMIT 1`);
  });

  it("holds no privilege on audit.event: SELECT, INSERT, UPDATE and DELETE all fail", async () => {
    const definition = await testDatabase.connect("definition");

    await denied(definition, `SELECT 1 FROM audit.event`);
    await denied(definition, `INSERT INTO audit.event (action) VALUES ('publish')`);
    await denied(definition, `UPDATE audit.event SET actor_id = 'someone else'`);
    await denied(definition, `DELETE FROM audit.event`);
  });

  it("neither application role holds DELETE or TRUNCATE on any table in the three schemas", async () => {
    const owner = await testDatabase.connect("owner");
    const grants = await owner.query(
      `SELECT role.name, c.oid::regclass::text AS relation, privilege.name AS privilege
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('qp_definition'), ('qp_execution')) AS role(name)
        CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE')) AS privilege(name)
        WHERE n.nspname IN ('definition', 'execution', 'audit')
          AND c.relkind IN ('r', 'p')
          AND has_table_privilege(role.name, c.oid, privilege.name)`,
    );
    expect(grants.rows).toEqual([]);
  });

  it("reaches a definition table created by a later migration, through default privileges", async () => {
    const owner = await testDatabase.connect("owner");
    const definition = await testDatabase.connect("definition");
    await owner.query(`CREATE TABLE definition.added_later (id int PRIMARY KEY)`);
    try {
      await definition.query(`INSERT INTO definition.added_later (id) VALUES (1)`);
      const rows = await definition.query(`SELECT id FROM definition.added_later`);
      expect(rows.rowCount).toBe(1);
    } finally {
      await owner.query(`DROP TABLE definition.added_later`);
    }
  });
});

describe("audit.record", () => {
  it("is the only way in: qp_definition appends inside its own transaction and both commit together", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");
    const before = (await testDatabase.readAuditEvents()).length;

    await definition.query("BEGIN");
    await definition.query(`UPDATE definition.questionnaire SET closes_at = now() WHERE id = $1`, [
      published.questionnaireId,
    ]);
    const recorded = await definition.query(
      `SELECT audit.record('retire', $1, NULL, NULL, 'author-1', '{"closesAt":"now"}'::jsonb, 'trace-1') AS id`,
      [published.questionnaireId],
    );
    await definition.query("COMMIT");

    const events = await testDatabase.readAuditEvents();
    expect(recorded.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)).toMatchObject({ action: "retire", questionnaire_id: published.questionnaireId, actor_id: "author-1" });
  });

  it("is discarded with the domain change on ROLLBACK", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");
    const before = await testDatabase.readAuditEvents();

    await definition.query("BEGIN");
    await definition.query(`UPDATE definition.questionnaire SET closes_at = now() WHERE id = $1`, [
      published.questionnaireId,
    ]);
    await definition.query(`SELECT audit.record('retire', $1, NULL, NULL, 'author-1', NULL, NULL)`, [
      published.questionnaireId,
    ]);
    await definition.query("ROLLBACK");

    const questionnaire = await definition.query(`SELECT closes_at FROM definition.questionnaire WHERE id = $1`, [
      published.questionnaireId,
    ]);
    expect(questionnaire.rows[0].closes_at).toBeNull();
    expect(await testDatabase.readAuditEvents()).toEqual(before);
  });

  it("only appends actions from the closed list", async () => {
    const definition = await testDatabase.connect("definition");
    await expectSqlState(
      definition.query(`SELECT audit.record('delete_everything', NULL, NULL, NULL, NULL, NULL, NULL)`),
      SQLSTATE.checkViolation,
    );
  });

  it("pins its search_path and runs as audit_owner", async () => {
    const owner = await testDatabase.connect("owner");
    const fn = await owner.query(
      `SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, pg_get_userbyid(n.nspowner) AS schema_owner
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'audit' AND p.proname = 'record'`,
    );
    expect(fn.rows).toEqual([
      { prosecdef: true, proconfig: ["search_path=audit, pg_temp"], owner: "audit_owner", schema_owner: "audit_owner" },
    ]);
  });
});
