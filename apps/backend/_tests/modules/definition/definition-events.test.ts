import { definitionApi, formatDraftEtag, type DraftItem, type QuestionInput } from "@qp/shared";
import { MAX_FINDINGS } from "@qp/telemetry";
import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../../src/db/client.js";
import { createQuestionnaire } from "../../../src/db/definition/questionnaires.js";
import { createQuestion } from "../../../src/db/definition/questions.js";
import { definitionModule } from "../../../src/modules/definition/plugin.js";
import { actor, aDraftWithOneItem, aPublishedQuestionnaire, useTestDatabase } from "../../db/fixtures.js";
import { definitionUrl, publish, saveDraft, theOpenDraft } from "./fixtures.js";

const testDatabase = useTestDatabase();

const QUESTIONNAIRE = "questionnaire.id";

const yesNo: QuestionInput = {
  type: "single_choice",
  prompt: "Do you have a medical condition?",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
};

let telemetry: TestTelemetry;
let app: FastifyInstance | undefined;

async function buildApp(database: Database = testDatabase.database("definition")): Promise<FastifyInstance> {
  const instance = Fastify();
  app = instance;
  await instance.register(definitionModule, { database, prefix: definitionApi.DEFINITION_PREFIX });
  await instance.ready();
  return instance;
}

interface TransactionHooks {
  readonly failAfterWork?: boolean;
  readonly afterCommit?: () => void;
}

function withTransactionHooks(database: Database, hooks: TransactionHooks): Database {
  return new Proxy(database, {
    get(target, property) {
      if (property !== "transaction") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (work: Parameters<Database["transaction"]>[0], config?: Parameters<Database["transaction"]>[1]) => {
        const result = await target.transaction(async (tx) => {
          const worked = await work(tx);
          if (hooks.failAfterWork === true) {
            throw new Error("the commit failed");
          }
          return worked;
        }, config);
        hooks.afterCommit?.();
        return result;
      };
    },
  });
}

beforeEach(() => {
  telemetry = installTestTelemetry();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await telemetry.shutdown();
});

function eventLines(name: string) {
  return telemetry.logs().filter((line) => line.msg === name);
}

async function metricPoints(name: string) {
  const all = await telemetry.metrics();
  return all.find((metric) => metric.descriptor.name === name)?.dataPoints.map((point) => ({ value: point.value, attributes: point.attributes }));
}

function spanNamed(name: string) {
  return telemetry.spans().find((span) => span.name === name);
}

async function auditTraceOf(action: string): Promise<string | null | undefined> {
  return (await testDatabase.readAuditTraceIds()).find((row) => row.action === action)?.trace_id;
}

function putDraft(instance: FastifyInstance, questionnaireId: string, etag: string, items: readonly DraftItem[]) {
  return instance.inject({
    method: "PUT",
    url: definitionUrl(`/questionnaires/${questionnaireId}/draft`),
    headers: { "if-match": etag },
    payload: { title: "Fixture", items },
  });
}

describe("questionnaire.created", () => {
  it("is emitted with the questionnaire id once it is stored, and the audit row carries the trace id of the create span", async () => {
    const instance = await buildApp();

    const response = await instance.inject({
      method: "POST",
      url: definitionUrl("/questionnaires"),
      payload: { name: "Fixture", title: "Fixture" },
    });

    expect(response.statusCode).toBe(201);
    const { questionnaireId } = response.json();
    expect(eventLines("questionnaire.created")).toMatchObject([{ [QUESTIONNAIRE]: questionnaireId }]);
    expect(await metricPoints("questionnaire.created")).toEqual([{ value: 1, attributes: {} }]);
    const span = spanNamed("questionnaire.create");
    expect(span?.attributes).toEqual({ [QUESTIONNAIRE]: questionnaireId });
    expect(await auditTraceOf("create_draft")).toBe(span?.spanContext().traceId);
  });
});

describe("questionnaire.created and questionnaire.retired are not emitted before their transactions commit", () => {
  it("emits questionnaire.created only after the create transaction has returned", async () => {
    const seenAtCommit: number[] = [];
    const instance = await buildApp(
      withTransactionHooks(testDatabase.database("definition"), {
        afterCommit: () => seenAtCommit.push(eventLines("questionnaire.created").length),
      }),
    );

    const response = await instance.inject({ method: "POST", url: definitionUrl("/questionnaires"), payload: { name: "Fixture", title: "Fixture" } });

    expect(response.statusCode).toBe(201);
    expect(seenAtCommit).toEqual([0]);
    expect(eventLines("questionnaire.created")).toHaveLength(1);
  });

  it("emits nothing for a create whose transaction rolls back after its work", async () => {
    const instance = await buildApp(withTransactionHooks(testDatabase.database("definition"), { failAfterWork: true }));

    const response = await instance.inject({ method: "POST", url: definitionUrl("/questionnaires"), payload: { name: "Fixture", title: "Fixture" } });

    expect(response.statusCode).toBe(500);
    expect(eventLines("questionnaire.created")).toEqual([]);
    expect(await metricPoints("questionnaire.created")).toBeUndefined();
  });

  it("emits questionnaire.retired only after the close-time transaction has returned, and nothing when it rolls back", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const seenAtCommit: number[] = [];
    const url = definitionUrl(`/questionnaires/${published.questionnaireId}/closes-at`);
    const payload = { closesAt: "2026-10-01T00:00:00.000Z" };
    const committing = await buildApp(
      withTransactionHooks(testDatabase.database("definition"), {
        afterCommit: () => seenAtCommit.push(eventLines("questionnaire.retired").length),
      }),
    );

    expect((await committing.inject({ method: "PUT", url, payload })).statusCode).toBe(200);

    expect(seenAtCommit).toEqual([0]);
    expect(eventLines("questionnaire.retired")).toHaveLength(1);
    await committing.close();
    telemetry.reset();
    const failing = await buildApp(withTransactionHooks(testDatabase.database("definition"), { failAfterWork: true }));

    expect((await failing.inject({ method: "PUT", url, payload: { closesAt: "2026-11-01T00:00:00.000Z" } })).statusCode).toBe(500);

    expect(eventLines("questionnaire.retired")).toEqual([]);
  });
});

describe("questionnaire.published", () => {
  it("is emitted with the version, in a questionnaire.publish span that carries the outcome, and the audit row has the span's trace id", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const instance = await buildApp();

    const response = await publish(instance, draft.questionnaireId, draft);

    expect(response.statusCode).toBe(201);
    expect(eventLines("questionnaire.published")).toMatchObject([{ [QUESTIONNAIRE]: draft.questionnaireId, "questionnaire.version": 1 }]);
    expect(await metricPoints("questionnaire.published")).toEqual([{ value: 1, attributes: {} }]);
    expect(await metricPoints("questionnaire.publish.total")).toEqual([{ value: 1, attributes: { "questionnaire.outcome": "accepted" } }]);
    const span = spanNamed("questionnaire.publish");
    expect(span?.attributes).toEqual({ [QUESTIONNAIRE]: draft.questionnaireId, "questionnaire.version": 1, "questionnaire.outcome": "accepted" });
    expect(await auditTraceOf("publish")).toBe(span?.spanContext().traceId);
  });

  it("is not emitted before the transaction commits", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const publishedAtCommit: number[] = [];
    const instance = await buildApp(
      withTransactionHooks(testDatabase.database("definition"), {
        afterCommit: () => publishedAtCommit.push(eventLines("questionnaire.published").length),
      }),
    );

    const response = await publish(instance, draft.questionnaireId, draft);

    expect(response.statusCode).toBe(201);
    expect(publishedAtCommit).toEqual([0]);
    expect(eventLines("questionnaire.published")).toHaveLength(1);
  });

  it("is never emitted for a publish whose transaction rolls back after its work, and the failure is counted as failed", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const instance = await buildApp(withTransactionHooks(testDatabase.database("definition"), { failAfterWork: true }));

    const response = await publish(instance, draft.questionnaireId, draft);

    expect(response.statusCode).toBe(500);
    const client = await testDatabase.connect("definition");
    const stored = await client.query("SELECT count(*)::int AS n FROM definition.questionnaire_version WHERE questionnaire_id = $1 AND status = 'published'", [
      draft.questionnaireId,
    ]);
    expect(stored.rows[0].n).toBe(0);
    expect((await testDatabase.readAuditTraceIds()).filter((row) => row.action === "publish")).toEqual([]);
    expect(eventLines("questionnaire.published")).toEqual([]);
    expect(await metricPoints("questionnaire.published")).toBeUndefined();
    expect(await metricPoints("questionnaire.publish.total")).toEqual([{ value: 1, attributes: { "questionnaire.outcome": "failed" } }]);
  });

  it("is never emitted for a publish that is refused, which is counted with the code of each item it names", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Invalid", title: "Invalid", ...actor });
    const first = await createQuestion(db, { key: null, content: yesNo, ...actor });
    const second = await createQuestion(db, { key: null, content: yesNo, ...actor });
    const items: DraftItem[] = [
      {
        itemId: "itm_01",
        required: false,
        visibleWhen: { all: [{ type: "single_choice", itemId: "itm_02", op: "is", optionId: "yes" }] },
        questionId: first.questionId,
        questionVersion: 1,
      },
      { itemId: "itm_02", required: false, visibleWhen: null, questionId: second.questionId, questionVersion: 1 },
    ];
    const draft = await saveDraft(db, created.questionnaireId, await theOpenDraft(db, created.questionnaireId), items);
    const instance = await buildApp();

    const response = await publish(instance, created.questionnaireId, draft);

    expect(response.statusCode).toBe(422);
    expect(eventLines("questionnaire.published")).toEqual([]);
    expect(eventLines("questionnaire.publish_rejected")).toMatchObject([
      { [QUESTIONNAIRE]: created.questionnaireId, "questionnaire.item_id": "itm_01", "problem.code": "predicate/forward-reference" },
    ]);
    expect(await metricPoints("questionnaire.publish.rejections")).toEqual([
      { value: 1, attributes: { "problem.code": "predicate/forward-reference" } },
    ]);
    expect(await metricPoints("questionnaire.publish.total")).toEqual([
      { value: 1, attributes: { "questionnaire.outcome": "rejected_validation" } },
    ]);
    expect(spanNamed("questionnaire.publish")?.attributes).toMatchObject({ "questionnaire.outcome": "rejected_validation" });
  });
});

describe("a publish refused for more items than the findings cap", () => {
  it("emits at most MAX_FINDINGS publish_rejected events and counts as many, though the problem names every item", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Many", title: "Many", ...actor });
    const items: DraftItem[] = [];
    for (let index = 0; index < MAX_FINDINGS + 5; index += 1) {
      const question = await createQuestion(db, { key: null, content: yesNo, ...actor });
      items.push({
        itemId: `itm_${index}`,
        required: false,
        visibleWhen: { all: [{ type: "single_choice", itemId: "itm_missing", op: "is", optionId: "yes" }] },
        questionId: question.questionId,
        questionVersion: 1,
      });
    }
    const draft = await saveDraft(db, created.questionnaireId, await theOpenDraft(db, created.questionnaireId), items);
    const instance = await buildApp();

    const response = await publish(instance, created.questionnaireId, draft);

    expect(response.statusCode).toBe(422);
    expect(response.json<{ items: unknown[] }>().items).toHaveLength(MAX_FINDINGS + 5);
    expect(eventLines("questionnaire.publish_rejected")).toHaveLength(MAX_FINDINGS);
    const points = (await metricPoints("questionnaire.publish.rejections")) ?? [];
    expect(points.reduce((total, point) => total + Number(point.value), 0)).toBe(MAX_FINDINGS);
  });
});

describe("a stale draft", () => {
  it("counts a draft save and a publish refused as stale, and counts the publish as a conflict", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const instance = await buildApp();
    const items: DraftItem[] = [{ itemId: "itm_01", required: true, visibleWhen: null, questionId: draft.questionId, questionVersion: 1 }];
    const staleEtag = formatDraftEtag(draft.draftVersionId, draft.draftRevision);
    expect((await putDraft(instance, draft.questionnaireId, staleEtag, items)).statusCode).toBe(200);

    const staleSave = await putDraft(instance, draft.questionnaireId, staleEtag, items);
    const stalePublish = await publish(instance, draft.questionnaireId, draft);

    expect([staleSave.statusCode, stalePublish.statusCode]).toEqual([409, 409]);
    expect(eventLines("questionnaire.draft_conflict")).toHaveLength(2);
    expect(await metricPoints("questionnaire.draft.conflicts")).toEqual([{ value: 2, attributes: {} }]);
    expect(await metricPoints("questionnaire.publish.total")).toEqual([
      { value: 1, attributes: { "questionnaire.outcome": "rejected_conflict" } },
    ]);
    expect(eventLines("questionnaire.published")).toEqual([]);
  });
});

describe("questionnaire.retired", () => {
  it("is emitted when a close time is set or moved and not when it is cleared", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const instance = await buildApp();
    const setClosesAt = (closesAt: string | null) =>
      instance.inject({
        method: "PUT",
        url: definitionUrl(`/questionnaires/${published.questionnaireId}/closes-at`),
        payload: { closesAt },
      });

    const set = await setClosesAt("2026-10-01T00:00:00.000Z");
    const moved = await setClosesAt("2026-11-01T00:00:00.000Z");
    const cleared = await setClosesAt(null);

    expect([set.statusCode, moved.statusCode, cleared.statusCode]).toEqual([200, 200, 200]);
    expect(eventLines("questionnaire.retired")).toHaveLength(2);
    expect(eventLines("questionnaire.retired")[0]).toMatchObject({ [QUESTIONNAIRE]: published.questionnaireId });
    expect(await metricPoints("questionnaire.retired")).toEqual([{ value: 2, attributes: {} }]);
    expect(telemetry.spans().filter((span) => span.name === "questionnaire.retire")).toHaveLength(3);
    const traces = (await testDatabase.readAuditTraceIds()).filter((row) => row.action === "retire" || row.action === "reopen");
    expect(traces).toHaveLength(3);
    expect(traces.every((row) => row.trace_id !== null)).toBe(true);
  });
});

describe("the trace id of an audit write", () => {
  it("is the trace of the request, for every action a definition route audits", async () => {
    await telemetry.shutdown();
    telemetry = installTestTelemetry({ autoInstrumentation: true });
    const instance = await buildApp();
    const post = (path: string, payload?: object) =>
      instance.inject({ method: "POST", url: definitionUrl(path), ...(payload === undefined ? {} : { payload }) });

    const kept = await post("/questions", { question: yesNo });
    const archived = await post("/questions", { question: yesNo });
    const questionId = kept.json().questionId;
    await post(`/questions/${questionId}/versions`, { question: yesNo });
    await post(`/questions/${archived.json().questionId}/archive`);
    const created = await post("/questionnaires", { name: "Fixture", title: "Fixture" });
    const { questionnaireId } = created.json();
    const opened = await instance.inject({ method: "GET", url: definitionUrl(`/questionnaires/${questionnaireId}/draft`) });
    const items: DraftItem[] = [{ itemId: "itm_01", required: true, visibleWhen: null, questionId, questionVersion: 1 }];
    const saved = await putDraft(instance, questionnaireId, String(opened.headers.etag), items);
    const published = await instance.inject({
      method: "POST",
      url: definitionUrl(`/questionnaires/${questionnaireId}/publish`),
      headers: { "if-match": String(saved.headers.etag) },
    });
    const next = await post(`/questionnaires/${questionnaireId}/draft`);
    const closed = await instance.inject({
      method: "PUT",
      url: definitionUrl(`/questionnaires/${questionnaireId}/closes-at`),
      payload: { closesAt: "2026-10-01T00:00:00.000Z" },
    });
    const reopened = await instance.inject({
      method: "PUT",
      url: definitionUrl(`/questionnaires/${questionnaireId}/closes-at`),
      payload: { closesAt: null },
    });

    expect([kept, archived, created, opened, saved, published, next, closed, reopened].map((response) => response.statusCode)).toEqual([
      201, 201, 201, 200, 200, 201, 201, 200, 200,
    ]);
    await telemetry.metrics();
    const requestTraces = new Set(telemetry.spans().filter((span) => span.name === "request").map((span) => span.spanContext().traceId));
    const audited = await testDatabase.readAuditTraceIds();
    expect(audited.map((row) => row.action)).toEqual(
      expect.arrayContaining(["create_draft", "edit_draft", "publish", "retire", "reopen", "archive_question", "create_question_version"]),
    );
    expect(audited.filter((row) => row.trace_id === null)).toEqual([]);
    expect(audited.filter((row) => row.trace_id !== null && !requestTraces.has(row.trace_id))).toEqual([]);
  });
});
