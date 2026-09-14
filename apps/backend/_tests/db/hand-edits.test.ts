import type pg from "pg";
import { describe, expect, it } from "vitest";
import { replaceDraft } from "../../src/db/definition/questionnaires.js";
import { createQuestion } from "../../src/db/definition/questions.js";
import { aDraftWithOneItem, aTextQuestion } from "./fixtures.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

async function aDraftWithTwoItems(): Promise<string> {
  const definitionDb = testDatabase.database("definition");
  const draft = await aDraftWithOneItem(definitionDb);
  const second = await createQuestion(definitionDb, { key: null, content: aTextQuestion, createdBy: "test", traceId: null });
  const saved = await replaceDraft(definitionDb, {
    questionnaireId: draft.questionnaireId,
    precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
    title: "Fixture",
    items: [
      { itemId: "itm_01", required: false, visibleWhen: null, questionId: draft.questionId, questionVersion: 1 },
      { itemId: "itm_02", required: false, visibleWhen: null, questionId: second.questionId, questionVersion: 1 },
    ],
    actorId: null,
    traceId: null,
  });
  if (saved.outcome !== "saved") {
    throw new Error(saved.outcome);
  }
  return draft.draftVersionId;
}

async function swapPositions(client: pg.Client, draftVersionId: string): Promise<void> {
  await client.query(
    `UPDATE definition.questionnaire_item SET position = 1 WHERE questionnaire_version_id = $1 AND item_id = 'itm_01'`,
    [draftVersionId],
  );
  await client.query(
    `UPDATE definition.questionnaire_item SET position = 0 WHERE questionnaire_version_id = $1 AND item_id = 'itm_02'`,
    [draftVersionId],
  );
}

describe("hand edits to the generated 0000_schema.sql survive the full migration chain", () => {
  it("execution.response is range-partitioned on created_at", async () => {
    const owner = await testDatabase.connect("owner");
    const partitioning = await owner.query(
      `SELECT c.relkind, pt.partstrat, a.attname
         FROM pg_class c
         JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pt.partattrs[0]
        WHERE c.oid = 'execution.response'::regclass`,
    );
    expect(partitioning.rows).toEqual([{ relkind: "p", partstrat: "r", attname: "created_at" }]);
  });

  it("item_position_unique is DEFERRABLE INITIALLY IMMEDIATE", async () => {
    const owner = await testDatabase.connect("owner");
    const constraint = await owner.query(
      `SELECT condeferrable, condeferred FROM pg_constraint
        WHERE conname = 'item_position_unique' AND conrelid = 'definition.questionnaire_item'::regclass`,
    );
    expect(constraint.rows).toEqual([{ condeferrable: true, condeferred: false }]);
  });

  it("lets a reorder swap two positions with separate UPDATEs once the constraint is deferred", async () => {
    const draftVersionId = await aDraftWithTwoItems();
    const definition = await testDatabase.connect("definition");

    await definition.query("BEGIN");
    await definition.query("SET CONSTRAINTS definition.item_position_unique DEFERRED");
    await swapPositions(definition, draftVersionId);
    await definition.query("COMMIT");

    const order = await definition.query(
      `SELECT item_id FROM definition.questionnaire_item WHERE questionnaire_version_id = $1 ORDER BY position`,
      [draftVersionId],
    );
    expect(order.rows.map((row) => row.item_id)).toEqual(["itm_02", "itm_01"]);
  });

  it("rejects the same swap with 23505 when the constraint is left immediate", async () => {
    const draftVersionId = await aDraftWithTwoItems();
    const definition = await testDatabase.connect("definition");

    await definition.query("BEGIN");
    try {
      await expectSqlState(swapPositions(definition, draftVersionId), SQLSTATE.uniqueViolation);
    } finally {
      await definition.query("ROLLBACK");
    }
  });
});
