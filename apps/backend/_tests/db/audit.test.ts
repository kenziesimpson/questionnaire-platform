import { describe, expect, it } from "vitest";
import { recordAudit, type AuditEntry } from "../../src/db/audit.js";
import { useTestDatabase } from "./fixtures.js";

const testDatabase = useTestDatabase();

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

function entry(traceId: AuditEntry["traceId"]): AuditEntry {
  return {
    action: "create_question_version",
    questionnaireId: null,
    questionnaireVersionId: null,
    version: null,
    actorId: "author-1",
    summary: null,
    traceId,
  };
}

async function traceIdsWritten(traceId: AuditEntry["traceId"]): Promise<(string | null)[]> {
  await testDatabase.database("definition").transaction((tx) => recordAudit(tx, entry(traceId)));
  const rows = await testDatabase.readAuditTraceIds();
  return rows.filter((row) => row.action === "create_question_version").map((row) => row.trace_id);
}

describe("recordAudit: the trace id", () => {
  it("records the trace id it is given", async () => {
    expect(await traceIdsWritten(TRACE_ID)).toEqual([TRACE_ID]);
  });

  it.each([
    ["undefined, as activeTraceId() is with no active span", undefined],
    ["null", null],
  ])("records %s as null", async (_label, traceId) => {
    expect(await traceIdsWritten(traceId)).toEqual([null]);
  });
});
