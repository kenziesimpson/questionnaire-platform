import { v4 as uuidv4 } from "uuid";
import { describe, expect, it } from "vitest";
import { recordResponseView } from "../../../src/db/reporting/audit.js";
import { aPublishedQuestionnaire, useTestDatabase } from "../fixtures.js";

const testDatabase = useTestDatabase();

async function aView() {
  const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
  return {
    questionnaireId: published.questionnaireId,
    questionnaireVersionId: published.draftVersionId,
    version: published.version,
    sessionId: uuidv4(),
    actorId: "reader-1",
    traceId: "0af7651916cd43dd8448eb211c80319c",
  };
}

describe("recordResponseView", () => {
  it("appends one view_response row through audit.record with the session id as its whole summary", async () => {
    const view = await aView();

    const id = await testDatabase.database("reporting").transaction((tx) => recordResponseView(tx, view));

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const views = (await testDatabase.readAuditEvents()).filter((event) => event.action === "view_response");
    expect(views).toEqual([
      {
        action: "view_response",
        questionnaire_id: view.questionnaireId,
        questionnaire_version_id: view.questionnaireVersionId,
        version: view.version,
        actor_id: "reader-1",
        summary: { sessionId: view.sessionId },
      },
    ]);
    expect((await testDatabase.readAuditTraceIds()).filter((row) => row.action === "view_response")).toEqual([
      { action: "view_response", trace_id: view.traceId },
    ]);
  });

  it("refuses a session id that is not a uuid, so nothing else can be written into the summary", async () => {
    const view = await aView();

    await expect(
      testDatabase.database("reporting").transaction((tx) => recordResponseView(tx, { ...view, sessionId: "patient answered yes" })),
    ).rejects.toThrow();

    expect((await testDatabase.readAuditEvents()).filter((event) => event.action === "view_response")).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined, as activeTraceId() is with no active span", undefined],
  ])("records a missing trace id as null: %s", async (_label, traceId) => {
    const view = await aView();

    await testDatabase.database("reporting").transaction((tx) => recordResponseView(tx, { ...view, traceId }));

    expect((await testDatabase.readAuditTraceIds()).filter((row) => row.action === "view_response")).toEqual([
      { action: "view_response", trace_id: null },
    ]);
  });

  it("is discarded when the transaction it joined rolls back", async () => {
    const view = await aView();

    await expect(
      testDatabase.database("reporting").transaction(async (tx) => {
        await recordResponseView(tx, view);
        throw new Error("the read failed after the audit write");
      }),
    ).rejects.toThrow("the read failed");

    expect((await testDatabase.readAuditEvents()).filter((event) => event.action === "view_response")).toEqual([]);
  });
});
