import { PROBLEM_CONTENT_TYPE, QuestionnaireDraft, QuestionnaireSummary, formatDraftEtag, problemType } from "@qp/shared";
import Type from "typebox";
import { Value } from "typebox/value";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { createQuestionnaire } from "../../../../src/db/definition/questionnaires.js";
import { AUTHOR_PLACEHOLDER } from "../../../../src/modules/definition/author.js";
import { aDraftWithOneItem, aPublishedQuestionnaire } from "../../../db/fixtures.js";
import { useTestDatabase } from "../../../db/harness.js";
import { definitionUrl, useDefinitionApp } from "../harness.js";

const testDatabase = useTestDatabase();
const app = useDefinitionApp(testDatabase);

const actor = { createdBy: "test", traceId: null };

function setClosesAt(questionnaireId: string, closesAt: string | null) {
  return app().inject({
    method: "PUT",
    url: definitionUrl(`/questionnaires/${questionnaireId}/closes-at`),
    payload: { closesAt },
  });
}

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

describe("POST /questionnaires", () => {
  it("returns the new questionnaire's summary, and its draft opens at revision 0 with an ETag", async () => {
    const created = await app().inject({
      method: "POST",
      url: definitionUrl("/questionnaires"),
      payload: { name: "Intake", title: "Patient intake", key: "intake" },
    });

    expect(created.statusCode).toBe(201);
    const summary = created.json();
    expect(Value.Check(QuestionnaireSummary, summary)).toBe(true);
    expect(summary).toMatchObject({ key: "intake", name: "Intake", currentVersion: null, closesAt: null, hasDraft: true });

    const draft = await app().inject({ method: "GET", url: definitionUrl(`/questionnaires/${summary.questionnaireId}/draft`) });

    expect(draft.statusCode).toBe(200);
    const body = draft.json();
    expect(Value.Check(QuestionnaireDraft, body)).toBe(true);
    expect(body).toMatchObject({ questionnaireId: summary.questionnaireId, title: "Patient intake", items: [], questions: [] });
    expect(draft.headers.etag).toBe(formatDraftEtag(body.versionId, 0));
    expect(draft.headers["cache-control"]).toBe("no-store");
  });
});

describe("PUT /questionnaires/:id/closes-at", () => {
  it("sets, reschedules and clears closesAt, auditing retire, retire and reopen with from and to", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);

    const set = await setClosesAt(published.questionnaireId, "2026-10-01T02:00:00+02:00");
    const rescheduled = await setClosesAt(published.questionnaireId, "2026-11-01T00:00:00.000Z");
    const cleared = await setClosesAt(published.questionnaireId, null);

    expect([set.statusCode, rescheduled.statusCode, cleared.statusCode]).toEqual([200, 200, 200]);
    expect(Value.Check(QuestionnaireSummary, set.json())).toBe(true);
    expect(set.json()).toMatchObject({
      questionnaireId: published.questionnaireId,
      name: "Fixture",
      currentVersion: 1,
      hasDraft: false,
      closesAt: "2026-10-01T00:00:00.000Z",
    });
    expect(rescheduled.json()).toMatchObject({ closesAt: "2026-11-01T00:00:00.000Z" });
    expect(cleared.json()).toMatchObject({ closesAt: null, currentVersion: 1 });
    const client = await testDatabase.connect("definition");
    const stored = await client.query(`SELECT closes_at FROM definition.questionnaire WHERE id = $1`, [published.questionnaireId]);
    expect(stored.rows[0].closes_at).toBeNull();
    const retirementEvents = (await testDatabase.readAuditEvents()).filter((event) => ["retire", "reopen"].includes(event.action));
    expect(retirementEvents).toEqual([
      {
        action: "retire",
        questionnaire_id: published.questionnaireId,
        questionnaire_version_id: null,
        version: null,
        actor_id: AUTHOR_PLACEHOLDER,
        summary: { from: null, to: "2026-10-01T00:00:00.000Z" },
      },
      {
        action: "retire",
        questionnaire_id: published.questionnaireId,
        questionnaire_version_id: null,
        version: null,
        actor_id: AUTHOR_PLACEHOLDER,
        summary: { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" },
      },
      {
        action: "reopen",
        questionnaire_id: published.questionnaireId,
        questionnaire_version_id: null,
        version: null,
        actor_id: AUTHOR_PLACEHOLDER,
        summary: { from: "2026-11-01T00:00:00.000Z", to: null },
      },
    ]);
  });

  it("reports an open draft on a questionnaire that has never been published", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);

    const response = await setClosesAt(draft.questionnaireId, "2026-10-01T00:00:00.000Z");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ currentVersion: null, hasDraft: true, closesAt: "2026-10-01T00:00:00.000Z" });
  });

  it("answers 404 for an unknown questionnaire and writes no audit row", async () => {
    const response = await setClosesAt(uuidv7(), "2026-10-01T00:00:00.000Z");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found") });
    expect(await testDatabase.readAuditEvents()).toEqual([]);
  });
});
