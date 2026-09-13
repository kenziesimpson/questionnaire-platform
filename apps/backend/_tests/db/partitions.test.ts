import { describe, expect, it } from "vitest";
import {
  ensureResponsePartitions,
  responsePartitionFor,
  responsePartitionsFrom,
} from "../../src/db/partitions.js";
import { aPublishedQuestionnaire, aSession, insertResponse } from "./fixtures.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

describe("response partitions", () => {
  it("has no DEFAULT partition", async () => {
    const owner = await testDatabase.connect("owner");
    const bounds = await owner.query<{ bound: string }>(
      `SELECT pg_get_expr(c.relpartbound, c.oid) AS bound
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'execution.response'::regclass`,
    );
    expect(bounds.rows.length).toBeGreaterThanOrEqual(24);
    expect(bounds.rows.filter((row) => row.bound === "DEFAULT")).toEqual([]);
  });

  it("is pre-created monthly for 36 months from 2026-09 by the migration", async () => {
    const owner = await testDatabase.connect("owner");
    const names = await owner.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'execution.response'::regclass ORDER BY c.relname`,
    );
    const expected = responsePartitionsFrom(new Date("2026-09-01T00:00:00Z"), 36).map((partition) => partition.name);
    expect(names.rows.map((row) => row.name)).toEqual(expected);
  });

  it("fails an insert loudly when no partition covers created_at", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const sessionId = await aSession(execution, published);

    await expectSqlState(
      insertResponse(execution, published, sessionId, { question_type: "text", text_value: "late" }, new Date("2040-01-15T00:00:00Z")),
      SQLSTATE.noPartitionForRow,
    );
  });

  it("routes rows sharing one created_at to one partition", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const sessionId = await aSession(execution, published);
    const submittedAt = new Date("2026-11-30T23:59:59.999Z");

    await insertResponse(execution, published, sessionId, { question_type: "text", text_value: "one" }, submittedAt);
    await insertResponse(execution, published, sessionId, { question_type: "number", number_value: "2" }, submittedAt);

    const owner = await testDatabase.connect("owner");
    const placement = await owner.query<{ partition: string }>(
      `SELECT DISTINCT tableoid::regclass::text AS partition FROM execution.response WHERE session_id = $1`,
      [sessionId],
    );
    expect(placement.rows).toEqual([{ partition: "execution.response_2026_11" }]);
  });

  it("names a partition by its UTC month", () => {
    expect(responsePartitionFor(new Date("2027-01-31T23:30:00-05:00"))).toEqual({
      name: "response_2027_02",
      from: new Date("2027-02-01T00:00:00Z"),
      to: new Date("2027-03-01T00:00:00Z"),
    });
  });

  it("creates only the missing future partitions, and running it again creates none", async () => {
    const ownerDb = testDatabase.database("owner");

    const first = await ensureResponsePartitions(ownerDb, new Date("2029-07-10T00:00:00Z"), 4);
    const second = await ensureResponsePartitions(ownerDb, new Date("2029-07-10T00:00:00Z"), 4);

    expect(first).toEqual(["response_2029_09", "response_2029_10"]);
    expect(second).toEqual([]);
    const owner = await testDatabase.connect("owner");
    await owner.query(`DROP TABLE execution.response_2029_09, execution.response_2029_10`);
  });

  it("keeps DETACH PARTITION CONCURRENTLY available for archival", async () => {
    const ownerDb = testDatabase.database("owner");
    await ensureResponsePartitions(ownerDb, new Date("2031-01-01T00:00:00Z"), 1);
    const owner = await testDatabase.connect("owner");

    await owner.query(`ALTER TABLE execution.response DETACH PARTITION execution.response_2031_01 CONCURRENTLY`);

    const detached = await owner.query(
      `SELECT count(*)::int AS n FROM pg_inherits WHERE inhrelid = 'execution.response_2031_01'::regclass`,
    );
    expect(detached.rows[0].n).toBe(0);
    await owner.query(`DROP TABLE execution.response_2031_01`);
  });

  it("would lose DETACH PARTITION CONCURRENTLY if a DEFAULT partition existed, which is why there is none", async () => {
    const owner = await testDatabase.connect("owner");
    await owner.query(`CREATE TABLE execution.response_default PARTITION OF execution.response DEFAULT`);
    try {
      await expectSqlState(
        owner.query(`ALTER TABLE execution.response DETACH PARTITION execution.response_2026_09 CONCURRENTLY`),
        "55000",
      );
    } finally {
      await owner.query(`DROP TABLE execution.response_default`);
    }
  });
});
