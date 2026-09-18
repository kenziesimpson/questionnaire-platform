import { PROBLEM_CONTENT_TYPE, QuestionnaireDraft, QuestionnaireSummary, formatDraftEtag, problemType } from "@qp/shared";
import Type from "typebox";
import { Value } from "typebox/value";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { createQuestionnaire } from "../../../../src/db/definition/questionnaires.js";
import { AUTHOR_PLACEHOLDER } from "../../../../src/modules/definition/author.js";
import { actor, aDraftWithOneItem, aPublishedQuestionnaire, useTestDatabase } from "../../../db/fixtures.js";
import { definitionUrl } from "../fixtures.js";
import { useDefinitionApp } from "../harness.js";

const testDatabase = useTestDatabase();
const app = useDefinitionApp(testDatabase);

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

describe("QuestionnaireSummary.updatedAt", () => {
  const EARLIER = "2026-01-01T00:00:00.000Z";

  async function backdateDraft(questionnaireId: string): Promise<void> {
    const client = await testDatabase.connect("definition");
    await client.query("UPDATE definition.questionnaire_version SET updated_at = $1 WHERE questionnaire_id = $2 AND status = 'draft'", [
      EARLIER,
      questionnaireId,
    ]);
  }

  function getDraft(questionnaireId: string) {
    return app().inject({ method: "GET", url: definitionUrl(`/questionnaires/${questionnaireId}/draft`) });
  }

  async function listedUpdatedAt(questionnaireId: string): Promise<string | undefined> {
    const listed = await app().inject({ method: "GET", url: definitionUrl("/questionnaires") });
    return listed.json().find((row: QuestionnaireSummary) => row.questionnaireId === questionnaireId)?.updatedAt;
  }

  it("is the draft's updated_at on create, and moves to the new updated_at when the draft is written", async () => {
    const created = await app().inject({ method: "POST", url: definitionUrl("/questionnaires"), payload: { name: "Edited", title: "Edited" } });
    const { questionnaireId, updatedAt: createdUpdatedAt } = created.json();
    const opened = await getDraft(questionnaireId);
    expect(createdUpdatedAt).toBe(opened.json().updatedAt);
    await backdateDraft(questionnaireId);
    expect(await listedUpdatedAt(questionnaireId)).toBe(EARLIER);

    const written = await app().inject({
      method: "PUT",
      url: definitionUrl(`/questionnaires/${questionnaireId}/draft`),
      headers: { "if-match": opened.headers.etag ?? "" },
      payload: { title: "Edited again", items: [] },
    });

    expect(written.statusCode).toBe(200);
    expect(written.json().updatedAt).not.toBe(EARLIER);
    expect(await listedUpdatedAt(questionnaireId)).toBe(written.json().updatedAt);
  });

  it("does not move when closesAt is set or cleared, in the closes-at response or on the list", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    await backdateDraft(draft.questionnaireId);

    const set = await setClosesAt(draft.questionnaireId, "2026-10-01T00:00:00.000Z");
    const cleared = await setClosesAt(draft.questionnaireId, null);

    expect(set.json()).toMatchObject({ closesAt: "2026-10-01T00:00:00.000Z", updatedAt: EARLIER });
    expect(cleared.json()).toMatchObject({ closesAt: null, updatedAt: EARLIER });
    expect(await listedUpdatedAt(draft.questionnaireId)).toBe(EARLIER);
  });

  it("is the latest version's updated_at across a published version and the next draft", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);
    const client = await testDatabase.connect("definition");
    const stored = await client.query<{ updated_at: Date }>("SELECT updated_at FROM definition.questionnaire_version WHERE questionnaire_id = $1", [
      published.questionnaireId,
    ]);
    expect(await listedUpdatedAt(published.questionnaireId)).toBe(stored.rows[0]?.updated_at.toISOString());

    const next = await app().inject({ method: "POST", url: definitionUrl(`/questionnaires/${published.questionnaireId}/draft`) });

    expect(next.statusCode).toBe(201);
    expect(await listedUpdatedAt(published.questionnaireId)).toBe((await getDraft(published.questionnaireId)).json().updatedAt);
  });

  it("leaves the list in id order after an older questionnaire's draft is written; sorting on it is the client's", async () => {
    const db = testDatabase.database("definition");
    const older = await createQuestionnaire(db, { key: null, name: "Older", title: "Older", ...actor });
    const newer = await createQuestionnaire(db, { key: null, name: "Newer", title: "Newer", ...actor });
    await backdateDraft(newer.questionnaireId);
    const opened = await getDraft(older.questionnaireId);
    await app().inject({
      method: "PUT",
      url: definitionUrl(`/questionnaires/${older.questionnaireId}/draft`),
      headers: { "if-match": opened.headers.etag ?? "" },
      payload: { title: "Older, edited", items: [] },
    });

    const listed = await app().inject({ method: "GET", url: definitionUrl("/questionnaires") });

    expect(listed.json().map((row: QuestionnaireSummary) => row.questionnaireId)).toEqual([newer.questionnaireId, older.questionnaireId]);
    expect(listed.json()[1].updatedAt > listed.json()[0].updatedAt).toBe(true);
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
