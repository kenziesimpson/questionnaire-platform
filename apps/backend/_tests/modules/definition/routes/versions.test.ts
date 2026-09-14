import {
  PROBLEM_CONTENT_TYPE,
  PublishedDefinition,
  VersionSummary,
  formatDraftEtag,
  problemType,
  type DraftItem,
  type Predicate,
  type QuestionInput,
} from "@qp/shared";
import Type from "typebox";
import { Value } from "typebox/value";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import type { Database } from "../../../../src/db/client.js";
import { replaceDraft } from "../../../../src/db/definition/drafts.js";
import { createQuestionnaire } from "../../../../src/db/definition/questionnaires.js";
import { createQuestion } from "../../../../src/db/definition/questions.js";
import { AUTHOR_PLACEHOLDER } from "../../../../src/modules/definition/author.js";
import { aDraftWithOneItem, aPublishedQuestionnaire, aQuestionnairePublishedAs, aTextQuestion } from "../../../db/fixtures.js";
import { useTestDatabase } from "../../../db/harness.js";
import { definitionUrl, useDefinitionApp } from "../harness.js";

const testDatabase = useTestDatabase();
const app = useDefinitionApp(testDatabase);

interface OpenDraft {
  readonly draftVersionId: string;
  readonly draftRevision: number;
}

function publish(questionnaireId: string, draft: OpenDraft) {
  return app().inject({
    method: "POST",
    url: definitionUrl(`/questionnaires/${questionnaireId}/publish`),
    headers: { "if-match": formatDraftEtag(draft.draftVersionId, draft.draftRevision) },
  });
}

async function saveDraft(db: Database, questionnaireId: string, draft: OpenDraft, items: DraftItem[]): Promise<OpenDraft> {
  const saved = await replaceDraft(db, {
    questionnaireId,
    precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
    title: "Fixture",
    items,
    actorId: "test",
    traceId: null,
  });
  if (saved.outcome !== "saved") {
    throw new Error(`test draft was not saved: ${saved.outcome}`);
  }
  return { draftVersionId: saved.draftVersionId, draftRevision: saved.draftRevision };
}

async function createNextDraftDirectly(questionnaireId: string): Promise<OpenDraft> {
  const draftVersionId = uuidv7();
  const client = await testDatabase.connect("definition");
  await client.query(
    `INSERT INTO definition.questionnaire_version (id, questionnaire_id, status, title, created_by)
     VALUES ($1, $2, 'draft', 'Fixture', 'test')`,
    [draftVersionId, questionnaireId],
  );
  return { draftVersionId, draftRevision: 0 };
}

async function aSecondItem(db: Database): Promise<DraftItem> {
  const saved = await createQuestion(db, { key: null, content: aTextQuestion, createdBy: "test", traceId: null });
  return { itemId: "itm_02", required: false, visibleWhen: null, questionId: saved.questionId, questionVersion: 1 };
}

function firstItemOf(questionId: string): DraftItem {
  return { itemId: "itm_01", required: true, visibleWhen: null, questionId, questionVersion: 1 };
}

async function storedSnapshotText(questionnaireId: string, version: number): Promise<string> {
  const client = await testDatabase.connect("definition");
  const result = await client.query<{ snapshot: string }>(
    `SELECT snapshot::text AS snapshot FROM definition.questionnaire_version WHERE questionnaire_id = $1 AND version = $2`,
    [questionnaireId, version],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`version ${version} is not stored`);
  }
  return row.snapshot;
}

async function draftStatusOf(draftVersionId: string): Promise<string | undefined> {
  const client = await testDatabase.connect("definition");
  const result = await client.query<{ status: string }>(`SELECT status FROM definition.questionnaire_version WHERE id = $1`, [
    draftVersionId,
  ]);
  return result.rows[0]?.status;
}

const choiceQuestion: QuestionInput = {
  type: "single_choice",
  prompt: "Pick one",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
};

const invalidPlacements: [string, [Predicate | null, Predicate | null], { itemId: string; code: string }][] = [
  [
    "a forward reference",
    [{ all: [{ type: "single_choice", itemId: "itm_02", op: "is", optionId: "yes" }] }, null],
    { itemId: "itm_01", code: "predicate/forward-reference" },
  ],
  [
    "an unsatisfiable predicate",
    [
      null,
      {
        all: [
          { type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" },
          { type: "single_choice", itemId: "itm_01", op: "is", optionId: "no" },
        ],
      },
    ],
    { itemId: "itm_02", code: "predicate/unsatisfiable" },
  ],
];

describe("POST /questionnaires/:id/publish", () => {
  it("publishes v1 then v2, answers each with its VersionSummary, and leaves v1's snapshot byte-identical", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);

    const first = await publish(draft.questionnaireId, draft);

    expect(first.statusCode).toBe(201);
    expect(Value.Check(VersionSummary, first.json())).toBe(true);
    expect(first.json()).toMatchObject({
      questionnaireId: draft.questionnaireId,
      version: 1,
      publishedBy: null,
      itemCount: 1,
      formatVersion: 1,
    });
    const storedBefore = await storedSnapshotText(draft.questionnaireId, 1);
    const servedBefore = await app().inject({ method: "GET", url: definitionUrl(`/questionnaires/${draft.questionnaireId}/versions/1`) });

    const opened = await createNextDraftDirectly(draft.questionnaireId);
    const next = await saveDraft(db, draft.questionnaireId, opened, [firstItemOf(draft.questionId), await aSecondItem(db)]);
    const second = await publish(draft.questionnaireId, next);

    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ questionnaireId: draft.questionnaireId, version: 2, itemCount: 2, publishedBy: null });
    expect(await storedSnapshotText(draft.questionnaireId, 1)).toBe(storedBefore);
    const servedAfter = await app().inject({ method: "GET", url: definitionUrl(`/questionnaires/${draft.questionnaireId}/versions/1`) });
    expect(servedAfter.payload).toBe(servedBefore.payload);
    const publishEvents = (await testDatabase.readAuditEvents()).filter((event) => event.action === "publish");
    expect(publishEvents.map((event) => [event.version, event.actor_id])).toEqual([
      [1, AUTHOR_PLACEHOLDER],
      [2, AUTHOR_PLACEHOLDER],
    ]);
  });

  it.each(invalidPlacements)("refuses %s with 422 naming the item", async (_label, predicates, expectedItem) => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Invalid", title: "Invalid", createdBy: "test", traceId: null });
    const items: DraftItem[] = [];
    for (const [index, visibleWhen] of predicates.entries()) {
      const saved = await createQuestion(db, { key: null, content: choiceQuestion, createdBy: "test", traceId: null });
      items.push({ itemId: `itm_0${index + 1}`, required: false, visibleWhen, questionId: saved.questionId, questionVersion: 1 });
    }
    const draft = await saveDraft(db, created.questionnaireId, created, items);

    const response = await publish(created.questionnaireId, draft);

    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("questionnaire/draft-invalid"), items: [expectedItem] });
    expect(await draftStatusOf(draft.draftVersionId)).toBe("draft");
  });

  it("refuses a stale If-Match with 409 and leaves the draft open", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);

    const response = await publish(draft.questionnaireId, { ...draft, draftRevision: draft.draftRevision - 1 });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: problemType("questionnaire/draft-stale") });
    expect(await draftStatusOf(draft.draftVersionId)).toBe("draft");
  });

  it("refuses the previous draft's ETag with 409 even when the next draft has reached the same revision", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);
    const opened = await createNextDraftDirectly(published.questionnaireId);
    const next = await saveDraft(db, published.questionnaireId, opened, [firstItemOf(published.questionId)]);
    expect(next.draftRevision).toBe(published.draftRevision);

    const response = await publish(published.questionnaireId, published);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: problemType("questionnaire/draft-stale") });
    expect(await draftStatusOf(next.draftVersionId)).toBe("draft");
  });

  it("answers 404 when no draft is open and when the questionnaire does not exist", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);

    const noDraft = await publish(published.questionnaireId, published);
    const unknown = await publish(uuidv7(), published);

    for (const response of [noDraft, unknown]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ type: problemType("resource/not-found") });
    }
  });

  it("lets exactly one of two concurrent publishes of the same draft return 201", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);

    const responses = await Promise.all([publish(draft.questionnaireId, draft), publish(draft.questionnaireId, draft)]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 404]);
    const publishEvents = (await testDatabase.readAuditEvents()).filter((event) => event.action === "publish");
    expect(publishEvents).toHaveLength(1);
  });
});

describe("GET /questionnaires/:id/versions", () => {
  it("lists published versions newest first with metadata only, leaving out the open draft", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);
    const opened = await createNextDraftDirectly(published.questionnaireId);
    const next = await saveDraft(db, published.questionnaireId, opened, [firstItemOf(published.questionId), await aSecondItem(db)]);
    expect((await publish(published.questionnaireId, next)).statusCode).toBe(201);
    await createNextDraftDirectly(published.questionnaireId);

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
    expect(response.json()).toEqual(JSON.parse(await storedSnapshotText(published.questionnaireId, 1)));
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
    await createNextDraftDirectly(published.questionnaireId);

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
