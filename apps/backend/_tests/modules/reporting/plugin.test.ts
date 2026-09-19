import { PROBLEM_CONTENT_TYPE, problemType, RESPONSES_PAGE_SIZE, type SessionDetail, type SessionSummaryPage } from "@qp/shared";
import { INTAKE_ITEM_IDS, INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { describe, expect, it } from "vitest";
import { PublishedDefinitions } from "../../../src/db/execution/published-definitions.js";
import { aPublishedQuestionnaire, useTestDatabase } from "../../db/fixtures.js";
import { answersNo, answersYes, publishIntakeV2Relabel, seedIntakeV1 } from "../execution/fixtures.js";
import { aSessionStartedAt, listSessionsUrl, sessionDetailUrl, startedSessionId, submitFixtureAnswers } from "./fixtures.js";
import { useReportingApp } from "./harness.js";

const testDatabase = useTestDatabase();
const reportingApp = useReportingApp(testDatabase);

function executionDatabase() {
  return testDatabase.database("execution");
}

function freshDefinitions(): PublishedDefinitions {
  return new PublishedDefinitions();
}

function listSessions(questionnaireId: string, query: Record<string, string> = {}) {
  return reportingApp().inject({ method: "GET", url: listSessionsUrl(questionnaireId, query) });
}

function presentCursor(cursor: string | null): string {
  if (cursor === null) throw new Error("expected the page to carry a cursor");
  return cursor;
}

function sessionDetail(questionnaireId: string, sessionId: string) {
  return reportingApp().inject({ method: "GET", url: sessionDetailUrl(questionnaireId, sessionId) });
}

describe("GET /questionnaires/:id/responses", () => {
  it("answers 404 problem+json for an unknown questionnaire", async () => {
    const response = await listSessions("00000000-0000-0000-0000-000000000000");

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found") });
  });

  it("lists real submitted and in-progress sessions with per-session answered/hidden counts, no aggregation", async () => {
    await seedIntakeV1(testDatabase);
    const execution = executionDatabase();
    const definitions = freshDefinitions();
    const now = new Date();

    const yesSessionId = await startedSessionId(execution, definitions, INTAKE_QUESTIONNAIRE_ID, now);
    await submitFixtureAnswers(execution, definitions, yesSessionId, answersYes(), now);
    const noSessionId = await startedSessionId(execution, definitions, INTAKE_QUESTIONNAIRE_ID, now);
    await submitFixtureAnswers(execution, definitions, noSessionId, answersNo(), now);
    const inProgressSessionId = await startedSessionId(execution, definitions, INTAKE_QUESTIONNAIRE_ID, now);

    const response = await listSessions(INTAKE_QUESTIONNAIRE_ID);
    expect(response.statusCode).toBe(200);
    const page = response.json<SessionSummaryPage>();
    const bySessionId = new Map(page.items.map((item) => [item.sessionId, item]));

    expect(bySessionId.get(yesSessionId)).toMatchObject({
      status: "submitted",
      itemCount: 4,
      answeredCount: 4,
      hiddenCount: 0,
    });
    expect(bySessionId.get(noSessionId)).toMatchObject({
      status: "submitted",
      itemCount: 4,
      answeredCount: 2,
      hiddenCount: 2,
    });
    expect(bySessionId.get(inProgressSessionId)).toMatchObject({
      status: "in_progress",
      submittedAt: null,
      answeredCount: 0,
    });
  });

  it("filters by status and by version", async () => {
    await seedIntakeV1(testDatabase);
    const execution = executionDatabase();
    const definitions = freshDefinitions();
    const now = new Date();
    const submittedId = await startedSessionId(execution, definitions, INTAKE_QUESTIONNAIRE_ID, now);
    await submitFixtureAnswers(execution, definitions, submittedId, answersYes(), now);
    const inProgressId = await startedSessionId(execution, definitions, INTAKE_QUESTIONNAIRE_ID, now);

    const submittedOnly = (await listSessions(INTAKE_QUESTIONNAIRE_ID, { status: "submitted" })).json<SessionSummaryPage>();
    expect(submittedOnly.items.map((item) => item.sessionId)).toEqual([submittedId]);

    const inProgressOnly = (await listSessions(INTAKE_QUESTIONNAIRE_ID, { status: "in_progress" })).json<SessionSummaryPage>();
    expect(inProgressOnly.items.map((item) => item.sessionId)).toEqual([inProgressId]);

    const v1Only = (await listSessions(INTAKE_QUESTIONNAIRE_ID, { version: "1" })).json<SessionSummaryPage>();
    expect(v1Only.items.map((item) => item.sessionId).sort()).toEqual([inProgressId, submittedId].sort());

    const v2Only = (await listSessions(INTAKE_QUESTIONNAIRE_ID, { version: "2" })).json<SessionSummaryPage>();
    expect(v2Only.items).toEqual([]);
  });

  it("pages by (startedAt desc, id) with keyset cursors and no total count", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const total = RESPONSES_PAGE_SIZE + 5;
    const base = new Date("2026-09-01T00:00:00.000Z").getTime();
    const newestFirst: string[] = [];
    for (let i = total - 1; i >= 0; i -= 1) {
      newestFirst.push(await aSessionStartedAt(execution, published, new Date(base + i * 60_000)));
    }

    const firstPage = (await listSessions(published.questionnaireId)).json<SessionSummaryPage>();
    expect(firstPage.items.map((item) => item.sessionId)).toEqual(newestFirst.slice(0, RESPONSES_PAGE_SIZE));
    expect(firstPage.newerCursor).toBeNull();
    expect(firstPage.olderCursor).not.toBeNull();

    const secondPage = (
      await listSessions(published.questionnaireId, { cursor: presentCursor(firstPage.olderCursor) })
    ).json<SessionSummaryPage>();
    expect(secondPage.items.map((item) => item.sessionId)).toEqual(newestFirst.slice(RESPONSES_PAGE_SIZE));
    expect(secondPage.olderCursor).toBeNull();
    expect(secondPage.newerCursor).not.toBeNull();

    const backToFirst = (
      await listSessions(published.questionnaireId, { cursor: presentCursor(secondPage.newerCursor) })
    ).json<SessionSummaryPage>();
    expect(backToFirst.items.map((item) => item.sessionId)).toEqual(newestFirst.slice(0, RESPONSES_PAGE_SIZE));
  });

  it("keeps the (startedAt, id) tiebreak: sessions sharing one startedAt across a page boundary are neither dropped nor repeated", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");
    const base = new Date("2026-09-01T00:00:00.000Z").getTime();
    const tied = new Date(base);
    const distinctlyNewer = RESPONSES_PAGE_SIZE - 3;
    const tiedCount = 8;
    const stored: { id: string; startedAt: Date }[] = [];
    for (let i = 0; i < distinctlyNewer; i += 1) {
      const startedAt = new Date(base + (i + 1) * 60_000);
      stored.push({ id: await aSessionStartedAt(execution, published, startedAt), startedAt });
    }
    for (let i = 0; i < tiedCount; i += 1) {
      stored.push({ id: await aSessionStartedAt(execution, published, tied), startedAt: tied });
    }
    const newestFirst = stored
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .map((entry) => entry.id);

    const firstPage = (await listSessions(published.questionnaireId)).json<SessionSummaryPage>();
    const secondPage = (
      await listSessions(published.questionnaireId, { cursor: presentCursor(firstPage.olderCursor) })
    ).json<SessionSummaryPage>();
    const firstIds = firstPage.items.map((item) => item.sessionId);
    const secondIds = secondPage.items.map((item) => item.sessionId);

    expect(firstIds).toEqual(newestFirst.slice(0, RESPONSES_PAGE_SIZE));
    expect(secondIds).toEqual(newestFirst.slice(RESPONSES_PAGE_SIZE));
    expect(secondIds.length).toBeGreaterThan(0);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(stored.length);
    expect(secondPage.olderCursor).toBeNull();

    const backToFirst = (
      await listSessions(published.questionnaireId, { cursor: presentCursor(secondPage.newerCursor) })
    ).json<SessionSummaryPage>();
    expect(backToFirst.items.map((item) => item.sessionId)).toEqual(firstIds);
  });
});

describe("GET /questionnaires/:id/responses/:sessionId", () => {
  it("404s for an unknown session and for a session under the wrong questionnaire", async () => {
    await seedIntakeV1(testDatabase);
    const otherQuestionnaire = await aPublishedQuestionnaire(testDatabase.database("definition"));

    const unknown = await sessionDetail(INTAKE_QUESTIONNAIRE_ID, "00000000-0000-0000-0000-000000000000");
    expect(unknown.statusCode).toBe(404);

    const sessionId = await startedSessionId(executionDatabase(), freshDefinitions(), INTAKE_QUESTIONNAIRE_ID, new Date());
    const wrongQuestionnaire = await sessionDetail(otherQuestionnaire.questionnaireId, sessionId);
    expect(wrongQuestionnaire.statusCode).toBe(404);
  });

  it("derives hidden-vs-unanswered by re-running the shared visibility evaluator against the stored answers", async () => {
    await seedIntakeV1(testDatabase);
    const execution = executionDatabase();
    const definitions = freshDefinitions();
    const now = new Date();
    const sessionId = await startedSessionId(execution, definitions, INTAKE_QUESTIONNAIRE_ID, now);
    await submitFixtureAnswers(execution, definitions, sessionId, answersNo(), now);

    const response = await sessionDetail(INTAKE_QUESTIONNAIRE_ID, sessionId);
    expect(response.statusCode).toBe(200);
    const detail = response.json<SessionDetail>();
    const byItemId = new Map(detail.items.map((item) => [item.itemId, item]));

    expect(byItemId.get(INTAKE_ITEM_IDS.hasCondition)).toMatchObject({ visible: true, answer: { type: "single_choice" } });
    expect(byItemId.get(INTAKE_ITEM_IDS.whichCondition)).toMatchObject({ visible: false, answer: null });
    expect(byItemId.get(INTAKE_ITEM_IDS.diagnosedOn)).toMatchObject({ visible: false, answer: null });
    expect(byItemId.get(INTAKE_ITEM_IDS.pharmacy)).toMatchObject({ visible: true, answer: { type: "text" } });
  });

  it("renders question content from the session's own pinned version, not the questionnaire's latest", async () => {
    await seedIntakeV1(testDatabase);
    const execution = executionDatabase();
    const definitions = freshDefinitions();
    const startedAt = new Date();

    const sessionId = await startedSessionId(execution, definitions, INTAKE_QUESTIONNAIRE_ID, startedAt);
    await publishIntakeV2Relabel(testDatabase);
    await submitFixtureAnswers(execution, definitions, sessionId, answersYes(), new Date());

    const response = await sessionDetail(INTAKE_QUESTIONNAIRE_ID, sessionId);
    expect(response.statusCode).toBe(200);
    const detail = response.json<SessionDetail>();

    expect(detail.version).toBe(1);
    const whichCondition = detail.items.find((item) => item.itemId === INTAKE_ITEM_IDS.whichCondition);
    expect(whichCondition?.question).toMatchObject({ questionVersion: 3 });
    if (whichCondition?.question.type !== "single_choice") {
      throw new Error("expected the which-condition item to stay single_choice");
    }
    const hypertension = whichCondition.question.options.find((option) => option.optionId === "opt_hyperten");
    expect(hypertension?.label).toBe("Hypertension");
  });

  it("shows an in-progress session with nothing stored yet, and no digest or submittedAt", async () => {
    await seedIntakeV1(testDatabase);
    const sessionId = await startedSessionId(executionDatabase(), freshDefinitions(), INTAKE_QUESTIONNAIRE_ID, new Date());

    const response = await sessionDetail(INTAKE_QUESTIONNAIRE_ID, sessionId);
    expect(response.statusCode).toBe(200);
    const detail = response.json<SessionDetail>();

    expect(detail.status).toBe("in_progress");
    expect(detail.submittedAt).toBeNull();
    expect(detail.items.every((item) => item.answer === null)).toBe(true);
  });
});

describe("cache-control", () => {
  it("marks reporting responses no-store, like the execution session reads they mirror", async () => {
    await seedIntakeV1(testDatabase);
    const response = await listSessions(INTAKE_QUESTIONNAIRE_ID);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
