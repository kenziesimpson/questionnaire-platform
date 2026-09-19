import { describe, expect, it } from "vitest";
import { responseRowsBySession } from "../../../src/db/reporting/responses.js";
import { aPublishedQuestionnaire, aSession, insertResponse, useTestDatabase } from "../fixtures.js";

const testDatabase = useTestDatabase();

describe("responseRowsBySession", () => {
  it("keys the read on the session's submittedAt as well as its id, so it stays inside one partition", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const sessionId = await aSession(execution, published);
    const submittedAt = new Date("2026-10-15T12:00:00.000Z");
    await insertResponse(execution, published, sessionId, { question_type: "text", text_value: "stored in October" }, submittedAt);
    const reporting = testDatabase.database("reporting");

    const matching = await responseRowsBySession(reporting, [{ id: sessionId, submittedAt }]);
    const otherMonth = await responseRowsBySession(reporting, [{ id: sessionId, submittedAt: new Date("2026-11-15T12:00:00.000Z") }]);

    expect(matching.get(sessionId)).toHaveLength(1);
    expect(otherMonth.size).toBe(0);
  });

  it("issues no query for an empty page", async () => {
    expect((await responseRowsBySession(testDatabase.database("reporting"), [])).size).toBe(0);
  });
});
