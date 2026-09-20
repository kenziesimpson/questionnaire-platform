import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PublishedDefinitions } from "../../src/db/execution/published-definitions.js";
import { ensureResponsePartitions } from "../../src/db/partitions.js";
import { listSessionSummaries } from "../../src/db/reporting/sessions.js";
import { aSessionStartedAt } from "../modules/reporting/fixtures.js";
import { aPublishedQuestionnaire, expectSqlState, SQLSTATE, useTestDatabase } from "./fixtures.js";

const testDatabase = useTestDatabase();

const OBSERVABILITY_DOC = fileURLToPath(new URL("../../../../docs/6-observability.md", import.meta.url));

const BOUND_VALUE = "QP_BOUND_VALUE_A1B2C3";

const ADVISORY_LOCK = 7_241_001;
const ACTIVITY_POLLS = 200;
const ACTIVITY_POLL_MILLISECONDS = 50;

const PARTITIONS_AHEAD = "SELECT monitor.response_partition_months_ahead($1::timestamptz) AS months";

const RELATION_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;
const COLUMN_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "REFERENCES"] as const;

async function monthsAhead(asOf: string): Promise<number> {
  const monitor = await testDatabase.connect("monitor");
  const result = await monitor.query<{ months: number }>(PARTITIONS_AHEAD, [asOf]);
  return result.rows[0]?.months ?? Number.NaN;
}

function reviewQueries(): string[] {
  const doc = readFileSync(OBSERVABILITY_DOC, "utf8");
  const start = doc.indexOf("### 14.2 ");
  const rest = doc.slice(start + 1);
  const end = rest.search(/\n#{2,3} /);
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
}

describe("qp_monitor", () => {
  it("is a plain login role that belongs to pg_monitor and to no other role", async () => {
    const owner = await testDatabase.connect("owner");

    const membership = await owner.query<{ name: string }>(
      `SELECT granted.rolname AS name
         FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid
        WHERE m.member = 'qp_monitor'::regrole
        ORDER BY 1`,
    );
    const attributes = await owner.query(
      `SELECT rolsuper, rolcanlogin, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = 'qp_monitor'`,
    );

    expect(membership.rows.map((row) => row.name)).toEqual(["pg_monitor"]);
    expect(attributes.rows).toEqual([
      { rolsuper: false, rolcanlogin: true, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolreplication: false },
    ]);
  });

  it("holds no privilege of any kind on a relation in definition, execution or audit, so it cannot read an answer", async () => {
    const owner = await testDatabase.connect("owner");

    const relations = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('definition', 'execution', 'audit') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`,
    );
    const onTheRelation = await owner.query(
      `SELECT c.oid::regclass::text AS relation, privilege.name AS privilege
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN unnest($1::text[]) AS privilege(name)
        WHERE n.nspname IN ('definition', 'execution', 'audit')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege('qp_monitor', c.oid, privilege.name)`,
      [RELATION_PRIVILEGES],
    );
    const onAColumn = await owner.query(
      `SELECT c.oid::regclass::text AS relation, privilege.name AS privilege
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN unnest($1::text[]) AS privilege(name)
        WHERE n.nspname IN ('definition', 'execution', 'audit')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_any_column_privilege('qp_monitor', c.oid, privilege.name)`,
      [COLUMN_PRIVILEGES],
    );

    expect(relations.rows[0]?.n, "the catalog query must see the answer tables for the assertion to prove anything").toBeGreaterThan(20);
    expect(onTheRelation.rows).toEqual([]);
    expect(onAColumn.rows).toEqual([]);
  });

  it("cannot read the tables that carry answers or the audit trail, and cannot use the schemas or functions around them", async () => {
    const monitor = await testDatabase.connect("monitor");
    const owner = await testDatabase.connect("owner");

    for (const table of [
      "execution.response",
      "execution.session",
      "definition.questionnaire",
      "definition.questionnaire_version",
      "definition.question_version",
      "definition.published_questionnaire_version",
      "audit.event",
    ]) {
      await expectSqlState(monitor.query(`SELECT 1 FROM ${table} LIMIT 1`), SQLSTATE.insufficientPrivilege);
    }
    await expectSqlState(monitor.query(`SELECT audit.record('publish', NULL, NULL, NULL, 'intruder', NULL, NULL)`), SQLSTATE.insufficientPrivilege);
    const reach = await owner.query(
      `SELECT s.name, has_schema_privilege('qp_monitor', s.name, 'USAGE') AS usage
         FROM unnest(ARRAY['definition', 'execution', 'audit', 'monitor']) AS s(name) ORDER BY 1`,
    );
    const functions = await owner.query(
      `SELECT p.oid::regprocedure::text AS name
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('definition', 'execution', 'audit') AND has_function_privilege('qp_monitor', p.oid, 'EXECUTE')`,
    );
    const dataRoles = await owner.query(
      `SELECT r.name, pg_has_role('qp_monitor', r.name, 'MEMBER') AS member
         FROM unnest(ARRAY['pg_read_all_data', 'pg_write_all_data', 'pg_execute_server_program', 'pg_read_server_files']) AS r(name) ORDER BY 1`,
    );

    expect(reach.rows).toEqual([
      { name: "audit", usage: false },
      { name: "definition", usage: false },
      { name: "execution", usage: false },
      { name: "monitor", usage: true },
    ]);
    expect(functions.rows).toEqual([]);
    expect(dataRoles.rows.filter((row) => row.member)).toEqual([]);
  });

  it("holds no write privilege on the monitor schema, which it can only call into", async () => {
    const monitor = await testDatabase.connect("monitor");

    await expectSqlState(monitor.query(`CREATE TABLE monitor.planted (id int)`), SQLSTATE.insufficientPrivilege);
    await expectSqlState(monitor.query(`CREATE FUNCTION monitor.planted() RETURNS int LANGUAGE sql AS 'SELECT 1'`), SQLSTATE.insufficientPrivilege);
  });
});

describe("the monitor schema", () => {
  it("is owned by qp_owner and holds only SECURITY DEFINER functions that pin their search path, are owned by qp_owner and are executable by qp_monitor alone", async () => {
    const owner = await testDatabase.connect("owner");

    const schema = await owner.query<{ owner: string }>(`SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'monitor'`);
    const objects = await owner.query<{ relation: string }>(
      `SELECT c.oid::regclass::text AS relation FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'monitor'`,
    );
    const functions = await owner.query(
      `SELECT p.oid::regprocedure::text AS name,
              p.prosecdef,
              p.proconfig,
              pg_get_userbyid(p.proowner) AS owner,
              p.prorettype::regtype::text AS returns,
              has_function_privilege('qp_monitor', p.oid, 'EXECUTE') AS monitor,
              has_function_privilege('qp_definition', p.oid, 'EXECUTE') AS definition,
              has_function_privilege('qp_execution', p.oid, 'EXECUTE') AS execution,
              has_function_privilege('qp_reporting', p.oid, 'EXECUTE') AS reporting,
              EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                       WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'monitor'
        ORDER BY name`,
    );

    expect(schema.rows).toEqual([{ owner: "qp_owner" }]);
    expect(objects.rows, "the monitor schema holds functions only, never a table or view over an answer").toEqual([]);
    expect(functions.rows).toEqual([
      {
        name: "monitor.response_partition_months_ahead(timestamp with time zone)",
        prosecdef: true,
        proconfig: ["search_path=pg_catalog, pg_temp"],
        owner: "qp_owner",
        returns: "integer",
        monitor: true,
        definition: false,
        execution: false,
        reporting: false,
        public_execute: false,
      },
    ]);
  });
});

describe("monitor.response_partition_months_ahead", () => {
  it("counts the months after the current one that a partition covers, without a gap", async () => {
    expect(await monthsAhead("2026-09-19T00:00:00Z")).toBe(35);
    expect(await monthsAhead("2026-09-01T00:00:00Z")).toBe(35);
    expect(await monthsAhead("2028-08-31T23:59:59Z")).toBe(12);
    expect(await monthsAhead("2029-07-15T00:00:00Z")).toBe(1);
  });

  it("reads zero when only the current month is covered, when it is the last month, and when none is", async () => {
    expect(await monthsAhead("2029-08-31T23:59:59Z")).toBe(0);
    expect(await monthsAhead("2029-09-01T00:00:00Z")).toBe(0);
    expect(await monthsAhead("2026-08-31T23:59:59Z")).toBe(0);
  });

  it("stops counting at a missing month, so a gap reads as the months before it", async () => {
    const ownerDb = testDatabase.database("owner");
    const owner = await testDatabase.connect("owner");
    await ensureResponsePartitions(ownerDb, new Date("2035-03-01T00:00:00Z"), 2);
    await ensureResponsePartitions(ownerDb, new Date("2035-06-01T00:00:00Z"), 1);
    try {
      expect(await monthsAhead("2035-03-10T00:00:00Z")).toBe(1);
      expect(await monthsAhead("2035-04-10T00:00:00Z")).toBe(0);
      expect(await monthsAhead("2035-06-10T00:00:00Z")).toBe(0);
    } finally {
      await owner.query(`DROP TABLE execution.response_2035_03, execution.response_2035_04, execution.response_2035_06`);
    }
  });

  it("defaults to now and returns a whole number of months", async () => {
    const monitor = await testDatabase.connect("monitor");

    const result = await monitor.query<{ months: number }>(`SELECT monitor.response_partition_months_ahead() AS months`);

    expect(Number.isInteger(result.rows[0]?.months)).toBe(true);
  });
});

describe("pg_stat_statements as qp_monitor", () => {
  it("holds a statement with its constants replaced by placeholders, never the value bound to it", async () => {
    const execution = await testDatabase.connect("execution");
    const monitor = await testDatabase.connect("monitor");
    await execution.query("SELECT $1::text AS planted_statement_marker", [BOUND_VALUE]);

    const stored = await monitor.query<{ query: string; calls: string }>(
      `SELECT query, calls FROM pg_stat_statements WHERE query LIKE '%planted_statement_marker%' AND query NOT LIKE '%pg_stat_statements%'`,
    );
    const leaked = await monitor.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_statements WHERE query ILIKE '%' || $1 || '%'`, [
      BOUND_VALUE,
    ]);

    expect(stored.rows.length, "the planted statement must be in the view for the assertion to prove anything").toBeGreaterThan(0);
    expect(stored.rows[0]?.query).toContain("$1");
    expect(leaked.rows[0]?.n).toBe(0);
  });

  it.each(["definition", "execution", "reporting"] as const)("is closed to qp_%s, which would otherwise read its own statements", async (role) => {
    const client = await testDatabase.connect(role);

    await expectSqlState(client.query(`SELECT 1 FROM pg_stat_statements LIMIT 1`), SQLSTATE.insufficientPrivilege);
    await expectSqlState(client.query(`SELECT 1 FROM pg_stat_statements_info`), SQLSTATE.insufficientPrivilege);
  });

  it("can execute the two functions behind the views itself, since a view's function is checked as the calling user", async () => {
    const owner = await testDatabase.connect("owner");

    const executable = await owner.query<{ name: string; execute: boolean }>(
      `SELECT p.oid::regprocedure::text AS name, has_function_privilege('qp_monitor', p.oid, 'EXECUTE') AS execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname IN ('pg_stat_statements', 'pg_stat_statements_info') AND p.prokind = 'f' AND n.nspname = 'public'
        ORDER BY 1`,
    );

    expect(executable.rows).toEqual([
      { name: "pg_stat_statements(boolean)", execute: true },
      { name: "pg_stat_statements_info()", execute: true },
    ]);
  });

  it.each(["definition", "execution", "reporting"] as const)("is closed to qp_%s through the functions behind the views too", async (role) => {
    const client = await testDatabase.connect(role);
    const owner = await testDatabase.connect("owner");

    const executable = await owner.query<{ name: string; execute: boolean }>(
      `SELECT p.oid::regprocedure::text AS name, has_function_privilege($1, p.oid, 'EXECUTE') AS execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname IN ('pg_stat_statements', 'pg_stat_statements_info') AND p.prokind = 'f' AND n.nspname = 'public'
        ORDER BY 1`,
      [`qp_${role}`],
    );

    expect(executable.rows.map((row) => row.name)).toEqual(["pg_stat_statements(boolean)", "pg_stat_statements_info()"]);
    expect(executable.rows.filter((row) => row.execute)).toEqual([]);
    await expectSqlState(client.query(`SELECT 1 FROM pg_stat_statements(true) LIMIT 1`), SQLSTATE.insufficientPrivilege);
    await expectSqlState(client.query(`SELECT 1 FROM pg_stat_statements_info()`), SQLSTATE.insufficientPrivilege);
  });

  it("shows a statement that is still running in pg_stat_activity with its placeholder, not the value bound to it", async () => {
    const owner = await testDatabase.connect("owner");
    const execution = await testDatabase.connect("execution");
    const monitor = await testDatabase.connect("monitor");
    await owner.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK]);

    const held = execution.query("SELECT $1::text AS held_statement_marker FROM (SELECT pg_advisory_lock($2)) AS held", [BOUND_VALUE, ADVISORY_LOCK]);
    try {
      let seen: { query: string }[] = [];
      for (let attempt = 0; attempt < ACTIVITY_POLLS && seen.length === 0; attempt += 1) {
        const activity = await monitor.query<{ query: string }>(
          `SELECT query FROM pg_stat_activity
            WHERE query LIKE '%held_statement_marker%' AND pid <> pg_backend_pid() AND state = 'active'`,
        );
        seen = activity.rows;
        if (seen.length === 0) await new Promise((resolve) => setTimeout(resolve, ACTIVITY_POLL_MILLISECONDS));
      }

      expect(seen.length, "the running statement must be visible to qp_monitor for the assertion to prove anything").toBeGreaterThan(0);
      expect(seen[0]?.query).toContain("$1");
      expect(JSON.stringify(seen)).not.toContain(BOUND_VALUE);
    } finally {
      await owner.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK]);
      await held;
    }
  });

  it("shows another role's statement text, not the insufficient-privilege placeholder", async () => {
    const execution = await testDatabase.connect("execution");
    const monitor = await testDatabase.connect("monitor");
    await execution.query("SELECT 1 AS another_roles_marker");

    const seen = await monitor.query(`SELECT query FROM pg_stat_statements WHERE query LIKE '%another_roles_marker%' AND query NOT LIKE '%pg_stat_statements%'`);

    expect(seen.rows).toEqual([{ query: "SELECT $1 AS another_roles_marker" }]);
  });

  it("runs each query of the documented slow-statement review, which finds the statement listSessions issues", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);
    const execution = await testDatabase.connect("execution");
    await aSessionStartedAt(execution, published, new Date("2026-09-19T10:00:00.000Z"));
    await listSessionSummaries(testDatabase.database("reporting"), new PublishedDefinitions(), { questionnaireId: published.questionnaireId });
    const monitor = await testDatabase.connect("monitor");

    const queries = reviewQueries();
    const results = [];
    for (const query of queries) {
      results.push(await monitor.query<{ statement: string; calls: string }>(query));
    }

    expect(queries, "the review section of docs/6-observability.md must carry two SQL blocks").toHaveLength(2);
    expect(results[0]?.rows.length).toBeGreaterThan(0);
    const listed = results[1]?.rows ?? [];
    expect(listed.length, "the review must find the paged session read that listSessions issues").toBeGreaterThan(0);
    expect(listed.map((row) => row.statement).join("\n")).toContain('"execution"."session"');
    expect(Number(listed[0]?.calls)).toBeGreaterThanOrEqual(1);
  });
});
