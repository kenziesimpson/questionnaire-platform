import {
  PROBLEM_CONTENT_TYPE,
  Question,
  QuestionUsage,
  QuestionVersion,
  QuestionVersionSummary,
  problemType,
  type DraftItem,
  type QuestionInput,
} from "@qp/shared";
import type { LightMyRequestResponse } from "fastify";
import Type from "typebox";
import { Value } from "typebox/value";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import type { Database } from "../../../../src/db/client.js";
import { publishDraft } from "../../../../src/db/definition/publish.js";
import { createQuestionnaire, replaceDraft } from "../../../../src/db/definition/drafts.js";
import { appendQuestionVersion, createQuestion } from "../../../../src/db/definition/questions.js";
import { AUTHOR_PLACEHOLDER } from "../../../../src/modules/definition/author.js";
import { aTextQuestion } from "../../../db/fixtures.js";
import { useTestDatabase } from "../../../db/harness.js";
import { definitionUrl, useDefinitionApp } from "../harness.js";

const testDatabase = useTestDatabase();
const app = useDefinitionApp(testDatabase);

const actor = { createdBy: "test", traceId: null };

const aChoiceQuestion: QuestionInput = {
  type: "single_choice",
  prompt: "Which condition?",
  options: [
    { optionId: "opt_zeta", label: "Zeta" },
    { optionId: "opt_alpha", label: "Alpha" },
    { optionId: "other", label: "Other", freeform: true },
  ],
};

function post(url: string, payload?: Record<string, unknown>): Promise<LightMyRequestResponse> {
  return app().inject({ method: "POST", url: definitionUrl(url), ...(payload === undefined ? {} : { payload }) });
}

function get(url: string): Promise<LightMyRequestResponse> {
  return app().inject({ method: "GET", url: definitionUrl(url) });
}

async function aQuestion(content: QuestionInput = aTextQuestion): Promise<string> {
  const saved = await createQuestion(testDatabase.database("definition"), { key: null, content, ...actor });
  return saved.questionId;
}

function placement(itemId: string, questionId: string, questionVersion: number): DraftItem {
  return { itemId, required: false, visibleWhen: null, questionId, questionVersion };
}

interface OpenDraft {
  readonly draftVersionId: string;
  readonly draftRevision: number;
}

async function saveDraft(db: Database, questionnaireId: string, draft: OpenDraft, items: DraftItem[]) {
  const saved = await replaceDraft(db, {
    questionnaireId,
    precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
    title: "Usage",
    items,
    actorId: "test",
    traceId: null,
  });
  if (saved.outcome !== "saved") {
    throw new Error(`draft was not saved: ${saved.outcome}`);
  }
  return saved;
}

async function publish(db: Database, questionnaireId: string, draft: OpenDraft, items: DraftItem[]) {
  const saved = await saveDraft(db, questionnaireId, draft, items);
  const published = await publishDraft(db, {
    questionnaireId,
    precondition: { versionId: saved.draftVersionId, draftRevision: saved.draftRevision },
    actorId: "test",
    traceId: null,
  });
  if (published.outcome !== "published") {
    throw new Error(`draft was not published: ${published.outcome}`);
  }
}

async function openNextDraftDirectly(questionnaireId: string): Promise<OpenDraft> {
  const draftVersionId = uuidv7();
  const definition = await testDatabase.connect("definition");
  await definition.query(
    `INSERT INTO definition.questionnaire_version (id, questionnaire_id, status, title) VALUES ($1, $2, 'draft', 'Next')`,
    [draftVersionId, questionnaireId],
  );
  return { draftVersionId, draftRevision: 0 };
}

describe("POST /questions", () => {
  it("creates the question at version 1, with options in authored order and the placeholder author", async () => {
    const response = await post("/questions", { key: "which_condition", question: aChoiceQuestion });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(Value.Check(Question, body)).toBe(true);
    expect(body).toMatchObject({
      key: "which_condition",
      archivedAt: null,
      latest: {
        questionId: body.questionId,
        questionVersion: 1,
        type: "single_choice",
        prompt: "Which condition?",
        createdBy: AUTHOR_PLACEHOLDER,
        options: aChoiceQuestion.type === "single_choice" ? aChoiceQuestion.options : [],
      },
    });
    expect(await testDatabase.readAuditEvents()).toEqual([
      expect.objectContaining({
        action: "create_question_version",
        actor_id: AUTHOR_PLACEHOLDER,
        summary: { questionId: body.questionId, questionVersion: 1 },
      }),
    ]);
  });

  it("rejects a question-rule failure as request/invalid pointing into the body, and writes nothing", async () => {
    const response = await post("/questions", {
      question: { type: "number", prompt: "Age", numberKind: "integer", min: 120, max: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({
      type: problemType("request/invalid"),
      errors: [{ pointer: "/body/question/min", code: "question/min-exceeds-max" }],
    });
    expect((await get("/questions?includeArchived=true")).json()).toEqual([]);
    expect(await testDatabase.readAuditEvents()).toEqual([]);
  });
});

describe("GET /questions", () => {
  it("returns an empty list when the bank is empty", async () => {
    const response = await get("/questions");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("lists the latest version of each question newest first by id, keeping its order after an UPDATE", async () => {
    const db = testDatabase.database("definition");
    const first = await aQuestion();
    const second = await aQuestion(aChoiceQuestion);
    await appendQuestionVersion(db, { questionId: first, content: { type: "text", prompt: "Revised" }, ...actor });
    const definition = await testDatabase.connect("definition");
    await definition.query("UPDATE definition.question SET key = 'renamed' WHERE id = $1", [first]);

    const response = await get("/questions");

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(Type.Array(Question), body)).toBe(true);
    expect(body).toMatchObject([
      { questionId: second, latest: { questionVersion: 1, options: [{ optionId: "opt_zeta" }, { optionId: "opt_alpha" }, { optionId: "other", freeform: true }] } },
      { questionId: first, key: "renamed", latest: { questionVersion: 2, prompt: "Revised" } },
    ]);
  });

  it("hides archived questions unless includeArchived=true", async () => {
    const kept = await aQuestion();
    const archived = await aQuestion();
    expect((await post(`/questions/${archived}/archive`)).statusCode).toBe(200);

    const hidden = await get("/questions");
    const shown = await get("/questions?includeArchived=true");
    const explicitlyHidden = await get("/questions?includeArchived=false");

    expect(hidden.json().map((row: Question) => row.questionId)).toEqual([kept]);
    expect(explicitlyHidden.json().map((row: Question) => row.questionId)).toEqual([kept]);
    expect(shown.json().map((row: Question) => row.questionId)).toEqual([archived, kept]);
    expect(shown.json()[0].archivedAt).toEqual(expect.any(String));
  });
});

describe("GET /questions/:questionId", () => {
  it("returns the latest version with its metadata, archived or not", async () => {
    const db = testDatabase.database("definition");
    const questionId = await aQuestion();
    await appendQuestionVersion(db, { questionId, content: { type: "text", prompt: "Second" }, ...actor });
    await post(`/questions/${questionId}/archive`);

    const response = await get(`/questions/${questionId}`);

    expect(response.statusCode).toBe(200);
    expect(Value.Check(Question, response.json())).toBe(true);
    expect(response.json()).toMatchObject({ questionId, archivedAt: expect.any(String), latest: { questionVersion: 2, prompt: "Second" } });
  });
});

describe("POST /questions/:questionId/versions", () => {
  it("saves version 2 and leaves version 1 unchanged", async () => {
    const questionId = await aQuestion(aChoiceQuestion);
    const before = (await get(`/questions/${questionId}/versions/1`)).json();
    const revised: QuestionInput = {
      type: "single_choice",
      prompt: "Which condition do you have?",
      options: [{ optionId: "opt_alpha", label: "Alpha, relabelled" }],
    };

    const response = await post(`/questions/${questionId}/versions`, { question: revised });

    expect(response.statusCode).toBe(201);
    expect(Value.Check(QuestionVersion, response.json())).toBe(true);
    expect(response.json()).toMatchObject({ ...revised, questionId, questionVersion: 2, createdBy: AUTHOR_PLACEHOLDER });
    expect((await get(`/questions/${questionId}/versions/1`)).json()).toEqual(before);
    expect(before).toMatchObject({ questionVersion: 1, prompt: "Which condition?", createdBy: "test" });
    expect((await get(`/questions/${questionId}`)).json().latest).toEqual(response.json());
    expect((await testDatabase.readAuditEvents()).at(-1)).toMatchObject({
      action: "create_question_version",
      actor_id: AUTHOR_PLACEHOLDER,
      summary: { questionId, questionVersion: 2 },
    });
  });

  it("rejects a question-rule failure as request/invalid and saves no version", async () => {
    const questionId = await aQuestion();

    const response = await post(`/questions/${questionId}/versions`, {
      question: { type: "single_choice", prompt: "Pick", options: [{ optionId: "opt_a", label: "A" }, { optionId: "opt_a", label: "Again" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      type: problemType("request/invalid"),
      errors: [{ pointer: "/body/question/options/1/optionId", code: "question/duplicate-option-id" }],
    });
    expect((await get(`/questions/${questionId}/versions`)).json()).toHaveLength(1);
  });

  it("serializes two concurrent saves into versions 2 and 3", async () => {
    const questionId = await aQuestion();

    const responses = await Promise.all([
      post(`/questions/${questionId}/versions`, { question: { type: "text", prompt: "From tab A" } }),
      post(`/questions/${questionId}/versions`, { question: { type: "text", prompt: "From tab B" } }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(responses.map((response) => response.json().questionVersion).sort()).toEqual([2, 3]);
    expect((await get(`/questions/${questionId}/versions`)).json().map((row: QuestionVersionSummary) => row.questionVersion)).toEqual([3, 2, 1]);
  });
});

describe("GET /questions/:questionId/versions", () => {
  it("lists version metadata newest first", async () => {
    const db = testDatabase.database("definition");
    const questionId = await aQuestion();
    await appendQuestionVersion(db, { questionId, content: aChoiceQuestion, ...actor });
    await post(`/questions/${questionId}/versions`, { question: aTextQuestion });

    const response = await get(`/questions/${questionId}/versions`);

    expect(response.statusCode).toBe(200);
    expect(Value.Check(Type.Array(QuestionVersionSummary), response.json())).toBe(true);
    expect(response.json()).toMatchObject([
      { questionVersion: 3, type: "text", createdBy: AUTHOR_PLACEHOLDER },
      { questionVersion: 2, type: "single_choice", createdBy: "test" },
      { questionVersion: 1, type: "text", createdBy: "test" },
    ]);
  });
});

describe("POST /questions/:questionId/archive", () => {
  it("sets archivedAt once and audits only the first archive", async () => {
    const questionId = await aQuestion();

    const first = await post(`/questions/${questionId}/archive`);
    const again = await post(`/questions/${questionId}/archive`);

    expect(first.statusCode).toBe(200);
    expect(Value.Check(Question, first.json())).toBe(true);
    expect(first.json()).toMatchObject({ questionId, archivedAt: expect.any(String), latest: { questionVersion: 1 } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    const archives = (await testDatabase.readAuditEvents()).filter((event) => event.action === "archive_question");
    expect(archives).toEqual([expect.objectContaining({ actor_id: AUTHOR_PLACEHOLDER, summary: { questionId } })]);
  });

  it("leaves published placements of the question unaffected", async () => {
    const db = testDatabase.database("definition");
    const questionId = await aQuestion();
    const questionnaire = await createQuestionnaire(db, { key: null, name: "Placed", title: "Placed", ...actor });
    await publish(db, questionnaire.questionnaireId, questionnaire, [placement("itm_01", questionId, 1)]);

    await post(`/questions/${questionId}/archive`);

    expect((await get(`/questions/${questionId}/usage`)).json()).toEqual([
      { questionnaireId: questionnaire.questionnaireId, version: 1, questionVersion: 1 },
    ]);
  });
});

describe("GET /questions/:questionId/usage", () => {
  it("lists only published versions embedding the question, by questionnaire then version descending", async () => {
    const db = testDatabase.database("definition");
    const questionId = await aQuestion();
    await appendQuestionVersion(db, { questionId, content: { type: "text", prompt: "Second" }, ...actor });
    const unrelated = await aQuestion();

    const early = await createQuestionnaire(db, { key: null, name: "Early", title: "Early", ...actor });
    await publish(db, early.questionnaireId, early, [placement("itm_01", questionId, 1), placement("itm_02", unrelated, 1)]);
    const earlyNext = await openNextDraftDirectly(early.questionnaireId);
    await publish(db, early.questionnaireId, earlyNext, [placement("itm_01", questionId, 2)]);

    const late = await createQuestionnaire(db, { key: null, name: "Late", title: "Late", ...actor });
    await publish(db, late.questionnaireId, late, [placement("itm_01", questionId, 2)]);
    const lateNext = await openNextDraftDirectly(late.questionnaireId);
    await saveDraft(db, late.questionnaireId, lateNext, [placement("itm_01", questionId, 1)]);

    const draftOnly = await createQuestionnaire(db, { key: null, name: "Draft only", title: "Draft only", ...actor });
    await saveDraft(db, draftOnly.questionnaireId, draftOnly, [placement("itm_01", questionId, 2)]);

    const response = await get(`/questions/${questionId}/usage`);

    expect(response.statusCode).toBe(200);
    expect(Value.Check(Type.Array(QuestionUsage), response.json())).toBe(true);
    const byQuestionnaire = [
      [
        { questionnaireId: early.questionnaireId, version: 2, questionVersion: 2 },
        { questionnaireId: early.questionnaireId, version: 1, questionVersion: 1 },
      ],
      [{ questionnaireId: late.questionnaireId, version: 1, questionVersion: 2 }],
    ].sort(([a], [b]) => ((a?.questionnaireId ?? "") < (b?.questionnaireId ?? "") ? -1 : 1));
    expect(response.json()).toEqual(byQuestionnaire.flat());
  });

  it("is an empty list for a question no published version embeds", async () => {
    const questionId = await aQuestion();

    const response = await get(`/questions/${questionId}/usage`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});

describe("unknown ids", () => {
  const unknownId = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";

  it.each([
    ["GET", `/questions/${unknownId}`],
    ["GET", `/questions/${unknownId}/versions`],
    ["GET", `/questions/${unknownId}/versions/1`],
    ["GET", `/questions/${unknownId}/usage`],
    ["POST", `/questions/${unknownId}/archive`],
  ] as const)("%s %s is 404 resource/not-found", async (method, path) => {
    const response = await app().inject({ method, url: definitionUrl(path) });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found"), instance: definitionUrl(path) });
    expect(await testDatabase.readAuditEvents()).toEqual([]);
  });

  it("POST /questions/:questionId/versions for an unknown question is 404 and writes nothing", async () => {
    const response = await post(`/questions/${unknownId}/versions`, { question: aTextQuestion });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found") });
    expect(await testDatabase.readAuditEvents()).toEqual([]);
  });

  it("an unknown version of a known question is 404", async () => {
    const questionId = await aQuestion();

    const response = await get(`/questions/${questionId}/versions/2`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found") });
  });

  it("a question id that is not a uuid is 400 request/invalid", async () => {
    const response = await get("/questions/not-a-uuid");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ type: problemType("request/invalid"), errors: [{ pointer: "/params/questionId" }] });
  });
});
