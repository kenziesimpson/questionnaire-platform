import pg from "pg";
import { describe, expect, it } from "vitest";
import { useTestDatabase } from "./harness.js";
import { failureOf, linesMentioning, postgresServerLogPath, readPostgresLogAfterBarrier, uniqueToken } from "./postgres-log.js";
import { POSTGRES_SERVER_SETTINGS } from "./server.js";

const testDatabase = useTestDatabase();

const serverLogCaptured = postgresServerLogPath() !== undefined;

const APPLICATION_LOGINS = ["definition", "execution", "reporting"] as const;

const LOG_SETTINGS_THE_DOCS_RELY_ON = {
  log_parameter_max_length: POSTGRES_SERVER_SETTINGS.log_parameter_max_length,
  log_error_verbosity: POSTGRES_SERVER_SETTINGS.log_error_verbosity,
  log_parameter_max_length_on_error: "0",
  log_min_error_statement: "error",
  log_min_messages: "warning",
  log_statement: "none",
  log_min_duration_statement: "-1",
  log_duration: "off",
} as const;

async function sessionWith(settings: Record<string, string>): Promise<pg.Client> {
  const client = await testDatabase.connectAsAdmin();
  for (const [name, value] of Object.entries(settings)) {
    await client.query(`SET ${name} = '${value}'`);
  }
  await client.query("CREATE TEMP TABLE qp_log_probe (v text PRIMARY KEY, n integer NOT NULL CHECK (n > 0))");
  await client.query(
    `CREATE FUNCTION pg_temp.qp_log_detail(x text) RETURNS void LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'probe failed' USING DETAIL = x, HINT = x; END $$`,
  );
  await client.query(
    `CREATE FUNCTION pg_temp.qp_log_context(x text) RETURNS void LANGUAGE plpgsql AS $$
     BEGIN EXECUTE format('INSERT INTO pg_temp.qp_log_probe VALUES (%L, -1)', x); END $$`,
  );
  return client;
}

interface ProbeFailures {
  readonly duplicate: pg.DatabaseError;
  readonly checked: pg.DatabaseError;
  readonly detail: pg.DatabaseError;
  readonly context: pg.DatabaseError;
}

async function plantThroughStatements(client: pg.Client, token: string): Promise<ProbeFailures> {
  const inserted = await client.query("INSERT INTO qp_log_probe VALUES ($1, $2)", [token, 1]);
  expect(inserted.rowCount, "the bound value must be stored for the probe to prove anything").toBe(1);
  const duplicate = await failureOf(client, "INSERT INTO qp_log_probe VALUES ($1, $2)", [token, 1]);
  const checked = await failureOf(client, "INSERT INTO qp_log_probe VALUES ($1, $2)", [`${token}_ROW`, -1]);
  const detail = await failureOf(client, "SELECT pg_temp.qp_log_detail($1)", [token]);
  const context = await failureOf(client, "SELECT pg_temp.qp_log_context($1)", [`${token}_CONTEXT`]);
  return { duplicate, checked, detail, context };
}

function expectTheClientWasTold(token: string, failures: ProbeFailures): void {
  expect(failures.duplicate.code).toBe("23505");
  expect(failures.duplicate.detail, "the client is given the key, so the server had it to write").toContain(token);
  expect(failures.checked.code).toBe("23514");
  expect(failures.checked.detail).toContain(`${token}_ROW`);
  expect(failures.detail.detail).toBe(token);
  expect(failures.detail.hint).toBe(token);
  expect(failures.context.where).toContain(`${token}_CONTEXT`);
}

describe("the log settings the database docs rely on, as each application login sees them", () => {
  it.each(APPLICATION_LOGINS)("%s reads the values the compose db service sets and the defaults docs/6 §14.1 assumes", async (login) => {
    const client = await testDatabase.connect(login);

    const effective = await client.query<{ name: string; value: string }>(
      `SELECT name, current_setting(name) AS value FROM unnest($1::text[]) AS name`,
      [Object.keys(LOG_SETTINGS_THE_DOCS_RELY_ON)],
    );

    expect(Object.fromEntries(effective.rows.map((row) => [row.name, row.value]))).toEqual(LOG_SETTINGS_THE_DOCS_RELY_ON);
  });
});

describe.skipIf(!serverLogCaptured)("what the Postgres server log holds of a value the application bound (docs/6 §14.1)", () => {
  it("holds no bound parameter of a statement it logged, because log_parameter_max_length is 0", async () => {
    const token = uniqueToken();
    const session = await sessionWith({ log_statement: "all", log_error_verbosity: "default" });

    await session.query("INSERT INTO qp_log_probe VALUES ($1, $2)", [token, 1]);
    await session.query("SELECT $1::text AS probe", [token]);
    const log = await readPostgresLogAfterBarrier(testDatabase);

    expect(log, "the statement must have been logged for its absent parameters to mean anything").toMatch(
      /execute <unnamed>: INSERT INTO qp_log_probe VALUES \(\$1, \$2\)/,
    );
    expect(linesMentioning(log, token)).toEqual([]);
  });

  it("would hold it if the setting allowed parameters, so the test above is a real control", async () => {
    const token = uniqueToken();
    const session = await sessionWith({ log_statement: "all", log_error_verbosity: "default", log_parameter_max_length: "-1" });

    await session.query("INSERT INTO qp_log_probe VALUES ($1, $2)", [token, 1]);
    const log = await readPostgresLogAfterBarrier(testDatabase);

    expect(linesMentioning(log, token).some((line) => line.includes("parameters:"))).toBe(true);
  });

  it("holds no DETAIL, HINT or CONTEXT line, and no parameters on an error, because log_error_verbosity is terse", async () => {
    const token = uniqueToken();
    const session = await sessionWith({ log_parameter_max_length_on_error: "-1" });

    const failures = await plantThroughStatements(session, token);
    const log = await readPostgresLogAfterBarrier(testDatabase);

    expectTheClientWasTold(token, failures);
    expect(log, "the failing statements must have reached the log for their absent values to mean anything").toContain(
      'duplicate key value violates unique constraint "qp_log_probe_pkey"',
    );
    expect(linesMentioning(log, token)).toEqual([]);
  });

  it("would hold all of them with the default verbosity, so the test above is a real control", async () => {
    const token = uniqueToken();
    const session = await sessionWith({ log_error_verbosity: "default", log_parameter_max_length_on_error: "-1" });

    const failures = await plantThroughStatements(session, token);
    const log = await readPostgresLogAfterBarrier(testDatabase);

    expectTheClientWasTold(token, failures);
    const carrying = (prefix: string, needle: string) => linesMentioning(log, needle).some((line) => line.includes(prefix));
    expect(carrying("DETAIL:", `Key (v)=(${token})`)).toBe(true);
    expect(carrying("DETAIL:", `Failing row contains (${token}_ROW, -1)`)).toBe(true);
    expect(carrying("HINT:", token)).toBe(true);
    expect(carrying("CONTEXT:", `${token}_CONTEXT`)).toBe(true);
    expect(carrying("parameters:", token)).toBe(true);
  });

  it("still holds the primary error message, which names the value a cast rejected, and the STATEMENT line, which names an inline literal", async () => {
    const owner = await testDatabase.connect("owner");
    const bound = uniqueToken();
    const inline = uniqueToken();

    const boundFailure = await failureOf(owner, "SELECT $1::integer", [bound]);
    const inlineFailure = await failureOf(owner, `SELECT '${inline}'::integer`, []);
    const log = await readPostgresLogAfterBarrier(testDatabase);

    expect(boundFailure.message).toContain(bound);
    expect(inlineFailure.message).toContain(inline);
    const boundLines = linesMentioning(log, bound);
    expect(boundLines, "one line only: the ERROR line with the primary message").toHaveLength(1);
    expect(boundLines[0]).toContain("ERROR:");
    expect(log, "the statement is logged with its placeholder, not the value").toMatch(/STATEMENT: +SELECT \$1::integer/);
    const inlineLines = linesMentioning(log, inline);
    expect(inlineLines.some((line) => line.includes("ERROR:"))).toBe(true);
    expect(inlineLines.some((line) => line.includes("STATEMENT:"))).toBe(true);
  });
});
