import type pg from "pg";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "../../src/db/schema.js";
import { aDraftWithOneItem, aPublishedQuestionnaire, aSession, insertResponse } from "./fixtures.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

const AUTHORING_TABLES = [
  "definition.question",
  "definition.question_version",
  "definition.question_version_option",
  "definition.questionnaire_item",
  "definition.questionnaire_version",
] as const;

const auditRecordCall = `SELECT audit.record('publish', NULL, NULL, NULL, 'intruder', NULL, NULL)`;

const ACTIONS_QP_REPORTING_CANNOT_RECORD = AUDIT_ACTIONS.filter((action) => action !== "view_response");

const ACTION_SPELLINGS_QP_REPORTING_CANNOT_RECORD = [
  ...ACTIONS_QP_REPORTING_CANNOT_RECORD,
  "delete_everything",
  "VIEW_RESPONSE",
  " view_response",
  "view_response ",
  "",
];

const RECORD_WITH_ACTION = `SELECT audit.record($1, $2, $3, $4, 'reader-1', NULL, NULL)`;

const RECORD_VIEW_RESPONSE = `SELECT audit.record('view_response', $1, $2, $3, 'reader-1', $4::jsonb, $5) AS id`;

const A_SESSION_ID = "6f1c2a3e-8b7d-4c5f-9a10-3d2e1f0a9b8c";
const A_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

function aSessionSummary(sessionId: string = A_SESSION_ID): string {
  return JSON.stringify({ sessionId });
}

const PAYLOADS_QP_REPORTING_CANNOT_RECORD: readonly (readonly [string, string | null])[] = [
  ["a NULL summary", null],
  ["an extra key beside sessionId", JSON.stringify({ sessionId: A_SESSION_ID, answer: "yes" })],
  ["only another key", JSON.stringify({ session: A_SESSION_ID })],
  ["an empty object", "{}"],
  ["a sessionId that is not a uuid", JSON.stringify({ sessionId: "patient answered yes" })],
  ["a sessionId that is a uuid with a suffix", JSON.stringify({ sessionId: `${A_SESSION_ID} and more` })],
  ["a sessionId in upper case", JSON.stringify({ sessionId: A_SESSION_ID.toUpperCase() })],
  ["a sessionId without hyphens", JSON.stringify({ sessionId: A_SESSION_ID.replaceAll("-", "") })],
  ["a sessionId that is a number", JSON.stringify({ sessionId: 42 })],
  ["a sessionId that is null", JSON.stringify({ sessionId: null })],
  ["a sessionId that is a boolean", JSON.stringify({ sessionId: true })],
  ["a sessionId that is an array", JSON.stringify({ sessionId: [A_SESSION_ID] })],
  ["a sessionId that is a nested object", JSON.stringify({ sessionId: { sessionId: A_SESSION_ID } })],
  ["a top-level array", JSON.stringify([A_SESSION_ID])],
  ["a top-level string", JSON.stringify(A_SESSION_ID)],
  ["a top-level number", "7"],
  ["JSON null", "null"],
];

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
    await denied(execution, `DELETE FROM definition.questionnaire_item WHERE questionnaire_version_id = $1`, [
      published.draftVersionId,
    ]);
  });

  it("reads published versions through the view, questionnaires and the reverse index", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");

    const snapshot = await execution.query(
      `SELECT v.snapshot FROM definition.questionnaire q
         JOIN definition.published_questionnaire_version v ON v.id = q.current_version_id
        WHERE q.id = $1`,
      [published.questionnaireId],
    );
    const index = await execution.query(`SELECT 1 FROM definition.version_question_index WHERE questionnaire_version_id = $1`, [
      published.draftVersionId,
    ]);

    expect(snapshot.rows[0].snapshot.questionnaireId).toBe(published.questionnaireId);
    expect(index.rowCount).toBe(1);
  });

  it("sees no drafts through published_questionnaire_version", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);
    const draft = await aDraftWithOneItem(definitionDb);
    const execution = await testDatabase.connect("execution");

    const visible = await execution.query<{ id: string }>(
      `SELECT id FROM definition.published_questionnaire_version WHERE id = ANY($1::uuid[])`,
      [[published.draftVersionId, draft.draftVersionId]],
    );
    const drafts = await execution.query(
      `SELECT count(*)::int AS n FROM definition.published_questionnaire_version WHERE version IS NULL OR snapshot IS NULL`,
    );

    expect(visible.rows).toEqual([{ id: published.draftVersionId }]);
    expect(drafts.rows[0].n).toBe(0);
  });

  it("still pins a session through the composite foreign key without reading the base table", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");

    await expect(aSession(execution, published)).resolves.toMatch(/^[0-9a-f-]{36}$/);
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

describe("functions", () => {
  it("in definition, execution and audit grant no EXECUTE to PUBLIC", async () => {
    const owner = await testDatabase.connect("owner");
    const functions = await owner.query<{ name: string; public_execute: boolean }>(
      `SELECT p.oid::regprocedure::text AS name,
              EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                       WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('definition', 'execution', 'audit')
        ORDER BY name`,
    );
    expect(functions.rows.map((row) => row.name)).toEqual([
      "audit.record(text,uuid,uuid,integer,text,jsonb,text)",
      "definition.promote_draft(uuid,jsonb)",
      "definition.reject_item_mutation()",
      "definition.reject_mutation()",
    ]);
    expect(functions.rows.filter((row) => row.public_execute)).toEqual([]);
  });
});

describe("qp_definition", () => {
  it("cannot read or write execution.response or execution.session", async () => {
    const definition = await testDatabase.connect("definition");

    await denied(definition, `SELECT 1 FROM execution.response LIMIT 1`);
    await denied(definition, `SELECT 1 FROM execution.session LIMIT 1`);
    await denied(definition, `SELECT 1 FROM execution.response_2026_09 LIMIT 1`);
  });

  it("holds no privilege on published_questionnaire_version, which exists for execution", async () => {
    const definition = await testDatabase.connect("definition");

    await denied(definition, `SELECT 1 FROM definition.published_questionnaire_version`);
    await denied(definition, `UPDATE definition.published_questionnaire_version SET title = 'x'`);
  });

  it("holds no privilege on audit.event: SELECT, INSERT, UPDATE and DELETE all fail", async () => {
    const definition = await testDatabase.connect("definition");

    await denied(definition, `SELECT 1 FROM audit.event`);
    await denied(definition, `INSERT INTO audit.event (action) VALUES ('publish')`);
    await denied(definition, `UPDATE audit.event SET actor_id = 'someone else'`);
    await denied(definition, `DELETE FROM audit.event`);
  });

  it("holds DELETE only on definition.questionnaire_item, and neither application role holds TRUNCATE anywhere", async () => {
    const owner = await testDatabase.connect("owner");
    const grants = await owner.query(
      `SELECT role.name, c.oid::regclass::text AS relation, privilege.name AS privilege
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('qp_definition'), ('qp_execution'), ('qp_reporting')) AS role(name)
        CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE')) AS privilege(name)
        WHERE n.nspname IN ('definition', 'execution', 'audit')
          AND c.relkind IN ('r', 'p')
          AND has_table_privilege(role.name, c.oid, privilege.name)`,
    );
    expect(grants.rows).toEqual([
      { name: "qp_definition", relation: "definition.questionnaire_item", privilege: "DELETE" },
    ]);
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

  it("is out of qp_owner's reach: no USAGE on audit, so it cannot call audit.record", async () => {
    const owner = await testDatabase.connect("owner");
    const usage = await owner.query(`SELECT has_schema_privilege('qp_owner', 'audit', 'USAGE') AS usage`);

    expect(usage.rows[0].usage).toBe(false);
    await denied(owner, auditRecordCall);
  });

  it("is executable by qp_definition and qp_reporting and by neither qp_owner nor qp_execution", async () => {
    const owner = await testDatabase.connect("owner");
    const privileges = await owner.query(
      `SELECT has_function_privilege('qp_definition', p.oid, 'EXECUTE') AS definition,
              has_function_privilege('qp_reporting', p.oid, 'EXECUTE') AS reporting,
              has_function_privilege('qp_owner', p.oid, 'EXECUTE') AS owner,
              has_function_privilege('qp_execution', p.oid, 'EXECUTE') AS execution
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'audit' AND p.proname = 'record'`,
    );
    expect(privileges.rows).toEqual([{ definition: true, reporting: true, owner: false, execution: false }]);
  });

  it("accepts view_response, which qp_reporting records in its own transaction", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const reporting = await testDatabase.connect("reporting");
    const before = (await testDatabase.readAuditEvents()).length;

    await reporting.query("BEGIN");
    await reporting.query(
      RECORD_VIEW_RESPONSE,
      [published.questionnaireId, published.draftVersionId, published.version, aSessionSummary(), A_TRACE_ID],
    );
    await reporting.query("COMMIT");

    const events = await testDatabase.readAuditEvents();
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)).toMatchObject({
      action: "view_response",
      questionnaire_id: published.questionnaireId,
      questionnaire_version_id: published.draftVersionId,
      version: published.version,
      actor_id: "reader-1",
      summary: { sessionId: A_SESSION_ID },
    });
    expect((await testDatabase.readAuditTraceIds()).at(-1)).toEqual({ action: "view_response", trace_id: A_TRACE_ID });
  });

  it("accepts a view_response with no trace id, as when there is no active span", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const reporting = await testDatabase.connect("reporting");

    await reporting.query(RECORD_VIEW_RESPONSE, [
      published.questionnaireId,
      published.draftVersionId,
      published.version,
      aSessionSummary(),
      null,
    ]);

    expect((await testDatabase.readAuditTraceIds()).at(-1)).toEqual({ action: "view_response", trace_id: null });
  });

  it("is discarded with the read on ROLLBACK, for qp_reporting as for qp_definition", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const reporting = await testDatabase.connect("reporting");
    const before = await testDatabase.readAuditEvents();

    await reporting.query("BEGIN");
    await reporting.query(RECORD_VIEW_RESPONSE, [
      published.questionnaireId,
      published.draftVersionId,
      published.version,
      aSessionSummary(),
      null,
    ]);
    await reporting.query("ROLLBACK");

    expect(await testDatabase.readAuditEvents()).toEqual(before);
  });

  it.each(ACTION_SPELLINGS_QP_REPORTING_CANNOT_RECORD)("refuses qp_reporting the action %j and leaves no audit row", async (action) => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const reporting = await testDatabase.connect("reporting");
    const before = await testDatabase.readAuditEvents();

    await denied(reporting, RECORD_WITH_ACTION, [action, published.questionnaireId, published.draftVersionId, published.version]);

    expect(await testDatabase.readAuditEvents()).toEqual(before);
  });

  it("refuses qp_reporting a NULL action rather than passing it on to the table", async () => {
    const reporting = await testDatabase.connect("reporting");
    const before = await testDatabase.readAuditEvents();

    await denied(reporting, RECORD_WITH_ACTION, [null, null, null, null]);

    expect(await testDatabase.readAuditEvents()).toEqual(before);
  });

  it("names no caller-supplied text in the refusal", async () => {
    const reporting = await testDatabase.connect("reporting");

    const message = await reporting.query(RECORD_WITH_ACTION, ["patient answered yes", null, null, null]).then(
      () => undefined,
      (failure: unknown) => (failure instanceof Error ? failure.message : undefined),
    );

    expect(message).toBe("qp_reporting may record view_response only");
  });

  it("leaves nothing behind when a refused action aborts a qp_reporting transaction that had recorded view_response", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const reporting = await testDatabase.connect("reporting");
    const before = await testDatabase.readAuditEvents();

    await reporting.query("BEGIN");
    await reporting.query(RECORD_VIEW_RESPONSE, [
      published.questionnaireId,
      published.draftVersionId,
      published.version,
      aSessionSummary(),
      null,
    ]);
    await denied(reporting, RECORD_WITH_ACTION, ["publish", published.questionnaireId, null, null]);
    await reporting.query("ROLLBACK");

    expect(await testDatabase.readAuditEvents()).toEqual(before);
  });

  it.each(AUDIT_ACTIONS)("still records %s for qp_definition", async (action) => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");
    const before = (await testDatabase.readAuditEvents()).length;

    await definition.query(RECORD_WITH_ACTION, [action, published.questionnaireId, published.draftVersionId, published.version]);

    const events = await testDatabase.readAuditEvents();
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)).toMatchObject({ action, actor_id: "reader-1" });
  });

  it.each(AUDIT_ACTIONS)("still records %s when audit_owner calls it after SET ROLE from a qp_owner session, as the test harness does", async (action) => {
    const owner = await testDatabase.connect("owner");
    const before = (await testDatabase.readAuditEvents()).length;

    await owner.query("SET ROLE audit_owner");
    try {
      await owner.query(RECORD_WITH_ACTION, [action, null, null, null]);
    } finally {
      await owner.query("RESET ROLE");
    }

    expect(await testDatabase.readAuditEvents()).toHaveLength(before + 1);
  });

  it.each(PAYLOADS_QP_REPORTING_CANNOT_RECORD)("refuses qp_reporting a view_response with %s and leaves no audit row", async (_label, summary) => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const reporting = await testDatabase.connect("reporting");
    const before = await testDatabase.readAuditEvents();

    await denied(reporting, RECORD_VIEW_RESPONSE, [
      published.questionnaireId,
      published.draftVersionId,
      published.version,
      summary,
      A_TRACE_ID,
    ]);

    expect(await testDatabase.readAuditEvents()).toEqual(before);
  });

  it.each([
    ["a NULL questionnaire id", { questionnaireId: null }],
    ["a NULL questionnaire version id", { versionId: null }],
    ["a NULL version", { version: null }],
    ["a trace id that is not 32 lower-case hex digits", { traceId: "patient answered yes" }],
    ["a trace id in upper case", { traceId: A_TRACE_ID.toUpperCase() }],
    ["a trace id with a suffix", { traceId: `${A_TRACE_ID}0` }],
    ["an empty trace id", { traceId: "" }],
  ] as const)("refuses qp_reporting a view_response with %s and leaves no audit row", async (_label, override) => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const reporting = await testDatabase.connect("reporting");
    const before = await testDatabase.readAuditEvents();
    const callArgs = { questionnaireId: published.questionnaireId, versionId: published.draftVersionId, version: published.version, traceId: A_TRACE_ID, ...override };

    await denied(reporting, RECORD_VIEW_RESPONSE, [
      callArgs.questionnaireId,
      callArgs.versionId,
      callArgs.version,
      aSessionSummary(),
      callArgs.traceId,
    ]);

    expect(await testDatabase.readAuditEvents()).toEqual(before);
  });

  it("names no caller-supplied text in the payload refusal", async () => {
    const reporting = await testDatabase.connect("reporting");

    const message = await reporting
      .query(RECORD_VIEW_RESPONSE, [null, null, null, JSON.stringify({ sessionId: "patient answered yes" }), null])
      .then(
        () => undefined,
        (failure: unknown) => (failure instanceof Error ? failure.message : undefined),
      );

    expect(message).toBe("qp_reporting may record only the view_response row that names a session");
  });

  it("does not restrict qp_definition's payload: it still records any summary, trace id and NULL references", async () => {
    const definition = await testDatabase.connect("definition");

    await definition.query(RECORD_VIEW_RESPONSE, [null, null, null, JSON.stringify({ anything: ["goes"] }), "trace-1"]);

    expect((await testDatabase.readAuditTraceIds()).at(-1)).toEqual({ action: "view_response", trace_id: "trace-1" });
  });

  it("keeps refusing after SET ROLE to a role that holds EXECUTE, because session_user does not change under SET ROLE", async () => {
    const admin = await testDatabase.connectAsAdmin();

    await admin.query("BEGIN");
    try {
      await admin.query("GRANT qp_definition TO qp_reporting");
      await admin.query("SET SESSION AUTHORIZATION qp_reporting");
      await admin.query("SET ROLE qp_definition");
      const identities = await admin.query(`SELECT session_user AS session_user, current_user AS current_user`);
      expect(identities.rows).toEqual([{ session_user: "qp_reporting", current_user: "qp_definition" }]);

      await admin.query("SAVEPOINT before_record");
      await denied(admin, RECORD_WITH_ACTION, ["publish", null, null, null]);
      await admin.query("ROLLBACK TO SAVEPOINT before_record");
      await denied(admin, RECORD_VIEW_RESPONSE, [null, null, null, aSessionSummary(), null]);
    } finally {
      await admin.query("ROLLBACK");
    }

    expect(await testDatabase.readAuditEvents()).toEqual([]);
  });

  it("is executable by no role but qp_definition, qp_reporting, audit_owner and superusers, so a new grantee is noticed", async () => {
    const owner = await testDatabase.connect("owner");
    const grantees = await owner.query(
      `SELECT r.rolname
         FROM pg_roles r
        WHERE has_function_privilege(r.oid, 'audit.record(text,uuid,uuid,int,text,jsonb,text)'::regprocedure, 'EXECUTE')
          AND NOT r.rolsuper
          AND r.rolname NOT IN ('qp_definition', 'qp_reporting', 'audit_owner')
        ORDER BY 1`,
    );

    expect(grantees.rows).toEqual([]);
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

describe("qp_reporting", () => {
  it("reads execution.session and execution.response", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const sessionId = await aSession(execution, published);
    await insertResponse(execution, published, sessionId, { question_type: "text", text_value: "reporting can read this" });

    const reporting = await testDatabase.connect("reporting");
    const sessions = await reporting.query(`SELECT id FROM execution.session WHERE id = $1`, [sessionId]);
    const responses = await reporting.query(`SELECT text_value FROM execution.response WHERE session_id = $1`, [sessionId]);

    expect(sessions.rows).toEqual([{ id: sessionId }]);
    expect(responses.rows).toEqual([{ text_value: "reporting can read this" }]);
  });

  it("cannot write execution.session or execution.response — no new write path", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const sessionId = await aSession(execution, published);
    const reporting = await testDatabase.connect("reporting");

    await denied(
      reporting,
      `INSERT INTO execution.session (id, questionnaire_id, questionnaire_version_id, version, status) VALUES (gen_random_uuid(), $1, $2, $3, 'in_progress')`,
      [published.questionnaireId, published.draftVersionId, published.version],
    );
    await denied(reporting, `UPDATE execution.session SET status = 'submitted' WHERE id = $1`, [sessionId]);
    await denied(reporting, `DELETE FROM execution.session WHERE id = $1`, [sessionId]);
    await denied(
      reporting,
      `INSERT INTO execution.response (id, created_at, session_id, questionnaire_version_id, item_id, question_id, question_version, question_type, text_value)
       VALUES (gen_random_uuid(), now(), $1, $2, 'itm_01', $3, 1, 'text', 'x')`,
      [sessionId, published.draftVersionId, published.questionId],
    );
  });

  it("reads the published-versions view and the questionnaire id, and nothing else in definition", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const reporting = await testDatabase.connect("reporting");

    const versions = await reporting.query(
      `SELECT id, version FROM definition.published_questionnaire_version WHERE questionnaire_id = $1`,
      [published.questionnaireId],
    );
    const questionnaires = await reporting.query(`SELECT id FROM definition.questionnaire WHERE id = $1`, [published.questionnaireId]);
    expect(versions.rows).toEqual([{ id: published.draftVersionId, version: published.version }]);
    expect(questionnaires.rows).toEqual([{ id: published.questionnaireId }]);

    await denied(reporting, `SELECT name FROM definition.questionnaire LIMIT 1`);
    await denied(reporting, `SELECT current_version_id FROM definition.questionnaire LIMIT 1`);
    await denied(reporting, `SELECT * FROM definition.questionnaire LIMIT 1`);
    for (const table of ["definition.questionnaire_version", "definition.version_question_index", ...AUTHORING_TABLES]) {
      await denied(reporting, `SELECT 1 FROM ${table} LIMIT 1`);
    }
  });

  it("cannot write any definition table, and holds no privilege on audit.event itself", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const reporting = await testDatabase.connect("reporting");

    await denied(reporting, `UPDATE definition.questionnaire SET closes_at = now() WHERE id = $1`, [published.questionnaireId]);
    await denied(reporting, `UPDATE definition.questionnaire SET id = id WHERE id = $1`, [published.questionnaireId]);
    await denied(reporting, `DELETE FROM definition.questionnaire WHERE id = $1`, [published.questionnaireId]);
    await denied(reporting, `UPDATE definition.published_questionnaire_version SET title = 'x'`);
    await denied(reporting, `SELECT 1 FROM audit.event`);
    await denied(reporting, `INSERT INTO audit.event (action) VALUES ('view_response')`);
    await denied(reporting, `UPDATE audit.event SET actor_id = 'someone else'`);
    await denied(reporting, `DELETE FROM audit.event`);
  });

  it("holds SELECT on exactly four relations and no write privilege on any relation, so audit.record is its only write", async () => {
    const owner = await testDatabase.connect("owner");
    const readable = await owner.query(
      `SELECT c.oid::regclass::text AS relation
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('definition', 'execution', 'audit')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_any_column_privilege('qp_reporting', c.oid, 'SELECT')
        ORDER BY 1`,
    );
    const writable = await owner.query(
      `SELECT c.oid::regclass::text AS relation, privilege.name AS privilege
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('REFERENCES')) AS privilege(name)
        WHERE n.nspname IN ('definition', 'execution', 'audit')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_any_column_privilege('qp_reporting', c.oid, privilege.name)`,
    );
    const otherWrites = await owner.query(
      `SELECT c.oid::regclass::text AS relation, privilege.name AS privilege
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE'), ('TRIGGER')) AS privilege(name)
        WHERE n.nspname IN ('definition', 'execution', 'audit')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege('qp_reporting', c.oid, privilege.name)`,
    );

    expect(readable.rows.map((row) => row.relation)).toEqual([
      "definition.published_questionnaire_version",
      "definition.questionnaire",
      "execution.response",
      "execution.session",
    ]);
    expect(writable.rows).toEqual([]);
    expect(otherWrites.rows).toEqual([]);
  });

  it("keeps a distinct password from qp_execution, so it is a genuinely separate identity", async () => {
    expect(testDatabase.url("reporting")).not.toBe(testDatabase.url("execution"));
  });
});
