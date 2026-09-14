import {
  PublishedDefinition,
  QuestionnaireDraft,
  QuestionnaireSummary,
  VersionSummary,
  definitionApi,
  formatDraftEtag,
  problemType,
  type DraftItem,
  type QuestionInput,
  type RouteDefinition,
} from "@qp/shared";
import Fastify, { type RouteOptions } from "fastify";
import Type, { type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { definitionModule } from "../../../src/modules/definition/plugin.js";
import { useTestDatabase } from "../../db/harness.js";
import { definitionUrl, useDefinitionApp } from "./harness.js";

const testDatabase = useTestDatabase();
const app = useDefinitionApp(testDatabase);

interface RegisteredRoute {
  readonly method: RouteOptions["method"];
  readonly url: string;
  readonly schema: RouteOptions["schema"];
}

async function routesRegisteredByDefinitionModule(): Promise<RegisteredRoute[]> {
  const registered: RegisteredRoute[] = [];
  const probe = Fastify();
  probe.addHook("onRoute", ({ method, url, schema }) => {
    registered.push({ method, url, schema });
  });
  await probe.register(definitionModule, {
    database: testDatabase.database("definition"),
    prefix: definitionApi.DEFINITION_PREFIX,
  });
  await probe.ready();
  await probe.close();
  return registered;
}

function routeKey({ method, url }: { readonly method: RouteOptions["method"]; readonly url: string }): string {
  return `${String(method)} ${url}`;
}

function sharedRouteKey(route: RouteDefinition): string {
  return routeKey({ method: route.method, url: definitionUrl(route.url) });
}

describe("definition route completeness", () => {
  it("registers every shared definition route at its method and prefixed URL with the shared schema object, and nothing else", async () => {
    const registered = await routesRegisteredByDefinitionModule();
    const explicitlyRegistered = registered.filter((route) => route.method !== "HEAD");

    expect(explicitlyRegistered.map(routeKey).sort()).toEqual(definitionApi.definitionRoutes.map(sharedRouteKey).sort());
    for (const shared of definitionApi.definitionRoutes) {
      const match = explicitlyRegistered.find((route) => routeKey(route) === sharedRouteKey(shared));
      expect(match?.schema, sharedRouteKey(shared)).toBe(shared.schema);
    }
  });

  it("routes every shared definition route on the harness app", () => {
    const unrouted = definitionApi.definitionRoutes.filter(
      (route) => !app().hasRoute({ method: route.method, url: definitionUrl(route.url) }),
    );

    expect(unrouted.map(sharedRouteKey)).toEqual([]);
  });
});

const hasCondition: QuestionInput = {
  type: "single_choice",
  prompt: "Do you have a medical condition?",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
};

const whichCondition: QuestionInput = {
  type: "single_choice",
  prompt: "Which condition?",
  options: [
    { optionId: "opt_diabetes", label: "Diabetes" },
    { optionId: "opt_hyperten", label: "Hypertension" },
  ],
};

const whichConditionRelabelled: QuestionInput = {
  type: "single_choice",
  prompt: "Which condition?",
  options: [
    { optionId: "opt_diabetes", label: "Diabetes" },
    { optionId: "opt_hyperten", label: "High blood pressure (hypertension)" },
  ],
};

function placements(hasConditionId: string, whichConditionId: string, whichConditionVersion: number): DraftItem[] {
  return [
    { itemId: "itm_01", required: true, visibleWhen: null, questionId: hasConditionId, questionVersion: 1 },
    {
      itemId: "itm_02",
      required: true,
      visibleWhen: { all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] },
      questionId: whichConditionId,
      questionVersion: whichConditionVersion,
    },
  ];
}

function wireBody<const S extends TSchema>(schema: S, response: { json(): unknown }): Static<S> {
  const body: unknown = response.json();
  Value.Assert(schema, body);
  return body;
}

function snapshotEtag(questionnaireId: string, version: number): string {
  return `"${questionnaireId}:${version}:1"`;
}

describe("the definition API end to end", () => {
  it("authors, publishes, revises, republishes and retires a questionnaire through inject() alone", async () => {
    const inject = app().inject.bind(app());
    const questionnaireUrl = (questionnaireId: string, suffix: string) => definitionUrl(`/questionnaires/${questionnaireId}${suffix}`);
    const listQuestionnaires = async () => {
      const listed = await inject({ method: "GET", url: definitionUrl("/questionnaires") });
      expect(listed.statusCode).toBe(200);
      return wireBody(Type.Array(QuestionnaireSummary), listed);
    };

    const createdHasCondition = await inject({ method: "POST", url: definitionUrl("/questions"), payload: { question: hasCondition } });
    const createdWhichCondition = await inject({
      method: "POST",
      url: definitionUrl("/questions"),
      payload: { question: whichCondition },
    });
    expect([createdHasCondition.statusCode, createdWhichCondition.statusCode]).toEqual([201, 201]);
    const hasConditionId: string = createdHasCondition.json().questionId;
    const whichConditionId: string = createdWhichCondition.json().questionId;
    expect(createdWhichCondition.json().latest).toMatchObject({ questionVersion: 1, ...whichCondition });

    const createdQuestionnaire = await inject({
      method: "POST",
      url: definitionUrl("/questionnaires"),
      payload: { name: "Intake", title: "Health intake" },
    });
    expect(createdQuestionnaire.statusCode).toBe(201);
    const questionnaireId = wireBody(QuestionnaireSummary, createdQuestionnaire).questionnaireId;
    expect(createdQuestionnaire.json()).toMatchObject({ currentVersion: null, closesAt: null, hasDraft: true });

    const firstDraftRead = await inject({ method: "GET", url: questionnaireUrl(questionnaireId, "/draft") });
    expect(firstDraftRead.statusCode).toBe(200);
    const firstDraft = wireBody(QuestionnaireDraft, firstDraftRead);
    expect(firstDraft.items).toEqual([]);
    expect(firstDraftRead.headers.etag).toBe(formatDraftEtag(firstDraft.versionId, 0));

    const firstSave = await inject({
      method: "PUT",
      url: questionnaireUrl(questionnaireId, "/draft"),
      headers: { "if-match": formatDraftEtag(firstDraft.versionId, 0) },
      payload: { title: "Health intake", items: placements(hasConditionId, whichConditionId, 1) },
    });
    expect(firstSave.statusCode).toBe(200);
    expect(firstSave.headers.etag).toBe(formatDraftEtag(firstDraft.versionId, 1));
    expect(wireBody(QuestionnaireDraft, firstSave).items).toEqual(placements(hasConditionId, whichConditionId, 1));

    const firstValidation = await inject({ method: "POST", url: questionnaireUrl(questionnaireId, "/draft/validate") });
    expect(firstValidation.statusCode).toBe(200);
    expect(firstValidation.json()).toEqual({ valid: true, items: [] });

    const publishWithPreSaveEtag = await inject({
      method: "POST",
      url: questionnaireUrl(questionnaireId, "/publish"),
      headers: { "if-match": String(firstDraftRead.headers.etag) },
    });
    expect(publishWithPreSaveEtag.statusCode).toBe(409);
    expect(publishWithPreSaveEtag.json().type).toBe(problemType("questionnaire/draft-stale"));

    const publishedV1 = await inject({
      method: "POST",
      url: questionnaireUrl(questionnaireId, "/publish"),
      headers: { "if-match": String(firstSave.headers.etag) },
    });
    expect(publishedV1.statusCode).toBe(201);
    expect(wireBody(VersionSummary, publishedV1)).toMatchObject({ questionnaireId, version: 1, itemCount: 2 });
    expect((await listQuestionnaires()).find((summary) => summary.questionnaireId === questionnaireId)).toMatchObject({
      currentVersion: 1,
      hasDraft: false,
    });
    expect((await inject({ method: "GET", url: questionnaireUrl(questionnaireId, "/draft") })).statusCode).toBe(404);

    const v1BeforeRepublish = await inject({ method: "GET", url: questionnaireUrl(questionnaireId, "/versions/1") });
    expect(v1BeforeRepublish.statusCode).toBe(200);

    const revision = await inject({
      method: "POST",
      url: definitionUrl(`/questions/${whichConditionId}/versions`),
      payload: { question: whichConditionRelabelled },
    });
    expect(revision.statusCode).toBe(201);
    expect(revision.json()).toMatchObject({ questionId: whichConditionId, questionVersion: 2 });

    const nextDraftOpened = await inject({ method: "POST", url: questionnaireUrl(questionnaireId, "/draft") });
    expect(nextDraftOpened.statusCode).toBe(201);
    const nextDraft = wireBody(QuestionnaireDraft, nextDraftOpened);
    expect(nextDraft.versionId).not.toBe(firstDraft.versionId);
    expect(nextDraftOpened.headers.etag).toBe(formatDraftEtag(nextDraft.versionId, 0));
    expect(nextDraft.items).toEqual(placements(hasConditionId, whichConditionId, 1));

    const repinned = await inject({
      method: "PUT",
      url: questionnaireUrl(questionnaireId, "/draft"),
      headers: { "if-match": String(nextDraftOpened.headers.etag) },
      payload: { title: "Health intake", items: placements(hasConditionId, whichConditionId, 2) },
    });
    expect(repinned.statusCode).toBe(200);
    expect(repinned.headers.etag).toBe(formatDraftEtag(nextDraft.versionId, 1));
    const repinnedDraft = wireBody(QuestionnaireDraft, repinned);
    expect(repinnedDraft.items).toEqual(placements(hasConditionId, whichConditionId, 2));
    expect(repinnedDraft.questions.map(({ questionId, questionVersion }) => ({ questionId, questionVersion }))).toEqual([
      { questionId: hasConditionId, questionVersion: 1 },
      { questionId: whichConditionId, questionVersion: 2 },
    ]);

    const publishWithPreviousDraftEtag = await inject({
      method: "POST",
      url: questionnaireUrl(questionnaireId, "/publish"),
      headers: { "if-match": String(firstSave.headers.etag) },
    });
    expect(publishWithPreviousDraftEtag.statusCode).toBe(409);

    const publishedV2 = await inject({
      method: "POST",
      url: questionnaireUrl(questionnaireId, "/publish"),
      headers: { "if-match": String(repinned.headers.etag) },
    });
    expect(publishedV2.statusCode).toBe(201);
    expect(wireBody(VersionSummary, publishedV2)).toMatchObject({ questionnaireId, version: 2, itemCount: 2 });

    const history = await inject({ method: "GET", url: questionnaireUrl(questionnaireId, "/versions") });
    expect(history.statusCode).toBe(200);
    expect(wireBody(Type.Array(VersionSummary), history).map((summary) => summary.version)).toEqual([2, 1]);

    const v1AfterRepublish = await inject({ method: "GET", url: questionnaireUrl(questionnaireId, "/versions/1") });
    const v2 = await inject({ method: "GET", url: questionnaireUrl(questionnaireId, "/versions/2") });
    expect([v1AfterRepublish.statusCode, v2.statusCode]).toEqual([200, 200]);
    expect(v1AfterRepublish.body).toBe(v1BeforeRepublish.body);
    expect(v1AfterRepublish.headers.etag).toBe(snapshotEtag(questionnaireId, 1));
    expect(v2.headers.etag).toBe(snapshotEtag(questionnaireId, 2));
    const v1Snapshot = wireBody(PublishedDefinition, v1AfterRepublish);
    const v2Snapshot = wireBody(PublishedDefinition, v2);
    expect(v1Snapshot).toMatchObject({ questionnaireId, version: 1 });
    expect(v2Snapshot).toMatchObject({ questionnaireId, version: 2 });
    expect(v1Snapshot.items[1]?.question).toMatchObject({ questionId: whichConditionId, questionVersion: 1, ...whichCondition });
    expect(v2Snapshot.items[1]?.question).toMatchObject({
      questionId: whichConditionId,
      questionVersion: 2,
      ...whichConditionRelabelled,
    });
    expect(v2Snapshot.items[0]).toEqual(v1Snapshot.items[0]);

    const closed = await inject({
      method: "PUT",
      url: questionnaireUrl(questionnaireId, "/closes-at"),
      payload: { closesAt: "2030-01-01T00:00:00.000Z" },
    });
    expect(closed.statusCode).toBe(200);
    expect(wireBody(QuestionnaireSummary, closed)).toMatchObject({
      closesAt: "2030-01-01T00:00:00.000Z",
      currentVersion: 2,
      hasDraft: false,
    });
    expect((await listQuestionnaires()).find((summary) => summary.questionnaireId === questionnaireId)?.closesAt).toBe(
      "2030-01-01T00:00:00.000Z",
    );

    const reopened = await inject({
      method: "PUT",
      url: questionnaireUrl(questionnaireId, "/closes-at"),
      payload: { closesAt: null },
    });
    expect(reopened.statusCode).toBe(200);
    expect(wireBody(QuestionnaireSummary, reopened)).toMatchObject({ closesAt: null, currentVersion: 2 });
    expect((await listQuestionnaires()).find((summary) => summary.questionnaireId === questionnaireId)?.closesAt).toBeNull();
  });
});
