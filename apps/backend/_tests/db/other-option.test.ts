import { readFileSync } from "node:fs";
import path from "node:path";
import type pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { createQuestion, listQuestionVersionSummaries } from "../../src/db/definition/questions.js";
import { MIGRATIONS_FOLDER } from "../../src/db/migrator.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

const RESERVING_MIGRATION = "0015_other_option_id_reserved.sql";

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

function migrationStatements(file: string): string[] {
  return readFileSync(path.join(MIGRATIONS_FOLDER, file), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}

async function runInOrder(client: pg.Client, statements: readonly string[]): Promise<void> {
  for (const statement of statements) await client.query(statement);
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

  it("makes the reserving migration fail, not rewrite the row, when a stored option breaks the rule", async () => {
    const owner = await testDatabase.connect("owner");
    await owner.query("BEGIN");
    try {
      await runInOrder(owner, [
        `ALTER TABLE definition.question_version_option DROP CONSTRAINT freeform_exactly_when_other`,
        `ALTER TABLE definition.question_version_option ADD CONSTRAINT freeform_is_other CHECK (NOT freeform OR option_id = 'other')`,
        `CREATE UNIQUE INDEX qvo_one_freeform ON definition.question_version_option (question_id, version) WHERE freeform`,
      ]);
      const questionId = await aChoiceQuestionVersion(owner);
      await insertOption(owner, questionId, "other", false);

      await expectSqlState(runInOrder(owner, migrationStatements(RESERVING_MIGRATION)), SQLSTATE.checkViolation);
    } finally {
      await owner.query("ROLLBACK");
    }
  });
});
