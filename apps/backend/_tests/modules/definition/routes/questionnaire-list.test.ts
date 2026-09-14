import { PROBLEM_CONTENT_TYPE, QuestionnaireSummary, problemType } from "@qp/shared";
import Type from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { createQuestionnaire } from "../../../../src/db/definition/drafts.js";
import { aPublishedQuestionnaire } from "../../../db/fixtures.js";
import { useTestDatabase } from "../../../db/harness.js";
import { definitionUrl, useDefinitionApp } from "../harness.js";

const testDatabase = useTestDatabase();
const app = useDefinitionApp(testDatabase);

const actor = { createdBy: "test", traceId: null };

describe("GET /questionnaires", () => {
  it("returns an empty list when nothing has been created", async () => {
    const response = await app().inject({ method: "GET", url: definitionUrl("/questionnaires") });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("lists newest first by id, with the current version, closing time and whether a draft is open", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);
    const draftOnly = await createQuestionnaire(db, { key: "intake", name: "Draft only", title: "Draft only", ...actor });
    const closing = await createQuestionnaire(db, { key: null, name: "Closing", title: "Closing", ...actor });
    const definition = await testDatabase.connect("definition");
    await definition.query("UPDATE definition.questionnaire SET closes_at = $1 WHERE id = $2", [
      "2026-10-01T00:00:00.000Z",
      closing.questionnaireId,
    ]);

    const response = await app().inject({ method: "GET", url: definitionUrl("/questionnaires") });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(Type.Array(QuestionnaireSummary), body)).toBe(true);
    expect(body).toMatchObject([
      { questionnaireId: closing.questionnaireId, currentVersion: null, hasDraft: true, closesAt: "2026-10-01T00:00:00.000Z" },
      { questionnaireId: draftOnly.questionnaireId, key: "intake", name: "Draft only", currentVersion: null, hasDraft: true, closesAt: null },
      { questionnaireId: published.questionnaireId, currentVersion: 1, hasDraft: false, closesAt: null },
    ]);
    const ids = body.map((row: QuestionnaireSummary) => row.questionnaireId);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it("keeps its order after a row is updated", async () => {
    const db = testDatabase.database("definition");
    const first = await createQuestionnaire(db, { key: null, name: "First", title: "First", ...actor });
    const second = await createQuestionnaire(db, { key: null, name: "Second", title: "Second", ...actor });
    const definition = await testDatabase.connect("definition");
    await definition.query("UPDATE definition.questionnaire SET name = 'First, renamed' WHERE id = $1", [first.questionnaireId]);

    const response = await app().inject({ method: "GET", url: definitionUrl("/questionnaires") });

    expect(response.json().map((row: QuestionnaireSummary) => row.questionnaireId)).toEqual([
      second.questionnaireId,
      first.questionnaireId,
    ]);
  });

  it("answers an unknown definition path with a problem body", async () => {
    const response = await app().inject({ method: "GET", url: definitionUrl("/questionnaires/not-a-route/at-all") });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found"), status: 404 });
  });
});
