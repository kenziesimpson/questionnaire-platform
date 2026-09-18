import {
  PROBLEM_CONTENT_TYPE,
  PublishedDefinition,
  VersionSummary,
  problemType,
  type DraftItem,
} from "@qp/shared";
import Type from "typebox";
import { Value } from "typebox/value";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { aDraftWithOneItem, aPublishedQuestionnaire, aQuestionnairePublishedAs } from "../../../db/fixtures.js";
import { useTestDatabase } from "../../../db/harness.js";
import { aSecondItem, createNextDraftDirectly, publish, saveDraft, storedSnapshotText } from "../fixtures.js";
import { definitionUrl, useDefinitionApp } from "../harness.js";

const testDatabase = useTestDatabase();
const app = useDefinitionApp(testDatabase);

function firstItemOf(questionId: string): DraftItem {
  return { itemId: "itm_01", required: true, visibleWhen: null, questionId, questionVersion: 1 };
}

describe("GET /questionnaires/:id/versions", () => {
  it("lists published versions newest first with metadata only, leaving out the open draft", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);
    const opened = await createNextDraftDirectly(testDatabase, published.questionnaireId);
    const next = await saveDraft(db, published.questionnaireId, opened, [firstItemOf(published.questionId), await aSecondItem(db)]);
    expect((await publish(app(), published.questionnaireId, next)).statusCode).toBe(201);
    await createNextDraftDirectly(testDatabase, published.questionnaireId);

    const response = await app().inject({ method: "GET", url: definitionUrl(`/questionnaires/${published.questionnaireId}/versions`) });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(Type.Array(VersionSummary), body)).toBe(true);
    expect(body).toMatchObject([
      { questionnaireId: published.questionnaireId, version: 2, itemCount: 2, formatVersion: 1, publishedBy: null },
      { questionnaireId: published.questionnaireId, version: 1, itemCount: 1, formatVersion: 1, publishedBy: null },
    ]);
    expect(Object.keys(body[0]).sort()).toEqual(["formatVersion", "itemCount", "publishedAt", "publishedBy", "questionnaireId", "version"]);
    expect(Date.parse(body[0].publishedAt)).toBeGreaterThanOrEqual(Date.parse(body[1].publishedAt));
  });

  it("is empty for a questionnaire with only a draft and 404 for an unknown questionnaire", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);

    const draftOnly = await app().inject({ method: "GET", url: definitionUrl(`/questionnaires/${draft.questionnaireId}/versions`) });
    const unknown = await app().inject({ method: "GET", url: definitionUrl(`/questionnaires/${uuidv7()}/versions`) });

    expect(draftOnly.statusCode).toBe(200);
    expect(draftOnly.json()).toEqual([]);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ type: problemType("resource/not-found") });
  });
});

describe("GET /questionnaires/:id/versions/:v", () => {
  it("returns the stored snapshot verbatim with an immutable ETag and Cache-Control", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);

    const response = await app().inject({ method: "GET", url: definitionUrl(`/questionnaires/${published.questionnaireId}/versions/1`) });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe(`"${published.questionnaireId}:1:1"`);
    expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(Value.Check(PublishedDefinition, response.json())).toBe(true);
    expect(response.json()).toEqual(JSON.parse(await storedSnapshotText(testDatabase, published.questionnaireId, 1)));
  });

  it("answers 500 internal, naming no schema, for a stored snapshot that matches no known format", async () => {
    const { questionnaireId } = await aQuestionnairePublishedAs(testDatabase, { title: "" });

    const response = await app().inject({ method: "GET", url: definitionUrl(`/questionnaires/${questionnaireId}/versions/1`) });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("internal"), status: 500 });
    expect(response.body).not.toContain("PublishedDefinition");
    expect(response.body).not.toContain("format");
    expect(response.headers.etag).toBeUndefined();
  });

  it("answers 404 for a draft, an unknown version and an unknown questionnaire", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);
    await createNextDraftDirectly(testDatabase, published.questionnaireId);

    const paths = [
      `/questionnaires/${published.questionnaireId}/versions/2`,
      `/questionnaires/${published.questionnaireId}/versions/9`,
      `/questionnaires/${uuidv7()}/versions/1`,
    ];
    for (const path of paths) {
      const response = await app().inject({ method: "GET", url: definitionUrl(path) });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ type: problemType("resource/not-found") });
    }
  });
});
