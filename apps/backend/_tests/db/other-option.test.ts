import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, inject, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- this test migrates a scratch database of its own, which the harness does not hand out
import { openDatabase } from "../../src/db/client.js";
import { createQuestion, listQuestionVersionSummaries } from "../../src/db/definition/questions.js";
import { MIGRATIONS_FOLDER } from "../../src/db/migrations.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";
import { ROLE_NAMES, withDatabase, withRole, type ApplicationRole } from "./server.js";

const testDatabase = useTestDatabase();

async function aChoiceQuestionVersion(client: pg.Client): Promise<string> {
  const questionId = uuidv7();
  await client.query(`INSERT INTO definition.question (id) VALUES ($1)`, [questionId]);
  await client.query(
    `INSERT INTO definition.question_version (question_id, version, type, prompt) VALUES ($1, 1, 'multiple_choice', 'Which symptoms?')`,
    [questionId],
  );
  return questionId;
}

function insertOption(client: pg.Client, questionId: string, optionId: string, freeform: boolean, position = 0) {
  return client.query(
    `INSERT INTO definition.question_version_option (question_id, version, option_id, label, position, freeform)
     VALUES ($1, 1, $2, 'Label', $3, $4)`,
    [questionId, optionId, position, freeform],
  );
}

const RESERVING_MIGRATION_INDEX = 15;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface MigrationsBeforeReserving {
  readonly folder: string;
  readonly applied: number;
}

function copyOfMigrationsBeforeReserving(): MigrationsBeforeReserving {
  const folder = mkdtempSync(path.join(tmpdir(), "qp-before-0015-"));
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal: { entries: JournalEntry[] } = JSON.parse(readFileSync(journalPath, "utf8"));
  const isBeforeReserving = (entry: JournalEntry) => entry.idx < RESERVING_MIGRATION_INDEX;
  const kept = journal.entries.filter(isBeforeReserving);
  for (const entry of journal.entries.filter((each) => !isBeforeReserving(each))) rmSync(path.join(folder, `${entry.tag}.sql`));
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: kept }));
  return { folder, applied: kept.length };
}

async function migrateScratch(ownerUrl: string, migrationsFolder: string): Promise<void> {
  const handle = openDatabase(ownerUrl, { maxConnections: 1 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}

async function withScratchDatabase(work: (urlFor: (role: ApplicationRole) => string) => Promise<void>): Promise<void> {
  const server = inject("testDatabaseServer");
  const name = `qp_test_${process.env.VITEST_POOL_ID ?? "0"}_before_0015`;
  // eslint-disable-next-line no-restricted-syntax -- creating and dropping a database needs a connection to another one
  const admin = new pg.Client({ connectionString: server.adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name} OWNER qp_owner`);
    await work((role) => withDatabase(withRole(server.adminUrl, ROLE_NAMES[role], server.passwords[role]), name));
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}

function databaseErrorIn(failure: unknown): pg.DatabaseError | undefined {
  let current = failure;
  while (current instanceof Error) {
    if (current instanceof pg.DatabaseError) return current;
    current = current.cause;
  }
  return undefined;
}

describe("question_version_option: freeform exactly when the option id is other", () => {
  it.each<[string, string, boolean]>([
    ["the freeform other option", "other", true],
    ["an ordinary option", "opt_cough", false],
  ])("accepts %s", async (_, optionId, freeform) => {
    const definition = await testDatabase.connect("definition");
    const questionId = await aChoiceQuestionVersion(definition);

    expect((await insertOption(definition, questionId, optionId, freeform)).rowCount).toBe(1);
  });

  it.each<[string, string, boolean]>([
    ["an option with the other id that is not freeform", "other", false],
    ["a freeform option under another id", "opt_misc", true],
  ])("rejects %s", async (_, optionId, freeform) => {
    const definition = await testDatabase.connect("definition");
    const questionId = await aChoiceQuestionVersion(definition);

    await expectSqlState(insertOption(definition, questionId, optionId, freeform), SQLSTATE.checkViolation);
  });

  it("rejects a second freeform option in the same version through the primary key", async () => {
    const definition = await testDatabase.connect("definition");
    const questionId = await aChoiceQuestionVersion(definition);
    await insertOption(definition, questionId, "other", true);

    await expectSqlState(insertOption(definition, questionId, "other", true, 1), SQLSTATE.uniqueViolation);
  });

  it("stops the repository saving a plain other option that skipped the question rules, and writes no question", async () => {
    const db = testDatabase.database("definition");
    const questionId = uuidv7();

    await expectSqlState(
      createQuestion(db, {
        questionId,
        key: null,
        content: { type: "single_choice", prompt: "Pick", options: [{ optionId: "other", label: "None of these" }] },
        createdBy: "test",
        traceId: null,
      }),
      SQLSTATE.checkViolation,
    );
    expect(await listQuestionVersionSummaries(db, questionId)).toBeUndefined();
  });

  it("leaves the database on 0014, with the row untouched, when the migrator meets a stored option that breaks the rule", async () => {
    const beforeReserving = copyOfMigrationsBeforeReserving();
    await withScratchDatabase(async (urlFor) => {
      await migrateScratch(urlFor("owner"), beforeReserving.folder);
      // eslint-disable-next-line no-restricted-syntax -- the scratch database is not the harness's, so its clients are opened and closed here
      const definition = new pg.Client({ connectionString: urlFor("definition") });
      // eslint-disable-next-line no-restricted-syntax -- same scratch database
      const owner = new pg.Client({ connectionString: urlFor("owner") });
      await Promise.all([definition.connect(), owner.connect()]);
      try {
        const questionId = await aChoiceQuestionVersion(definition);
        await insertOption(definition, questionId, "other", false);

        const failure = await migrateScratch(urlFor("owner"), MIGRATIONS_FOLDER).then(
          () => undefined,
          (error: unknown) => error,
        );

        const refusal = databaseErrorIn(failure);
        expect(refusal?.code).toBe(SQLSTATE.checkViolation);
        expect(refusal?.message).toContain(`${questionId} version 1 option other`);
        expect((await owner.query(`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`)).rows).toEqual([
          { applied: beforeReserving.applied },
        ]);
        expect(
          (
            await owner.query(
              `SELECT conname AS name FROM pg_constraint WHERE conname IN ('freeform_is_other', 'freeform_exactly_when_other')
               UNION ALL SELECT indexname FROM pg_indexes WHERE indexname = 'qvo_one_freeform' ORDER BY name`,
            )
          ).rows,
        ).toEqual([{ name: "freeform_is_other" }, { name: "qvo_one_freeform" }]);
        expect(
          (await owner.query(`SELECT option_id, freeform FROM definition.question_version_option WHERE question_id = $1`, [questionId]))
            .rows,
        ).toEqual([{ option_id: "other", freeform: false }]);
      } finally {
        await Promise.all([definition.end(), owner.end()]);
      }
    }).finally(() => rmSync(beforeReserving.folder, { recursive: true, force: true }));
  });
});
