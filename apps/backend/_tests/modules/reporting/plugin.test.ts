import {
  PROBLEM_CONTENT_TYPE,
  problemType,
  RESPONSES_PAGE_SIZE,
  type SessionDetail,
  type SessionSort,
  type SessionSummaryPage,
  type SortOrder,
} from "@qp/shared";
import { INTAKE_ITEM_IDS, INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { describe, expect, it } from "vitest";
import { PublishedDefinitions } from "../../../src/db/execution/published-definitions.js";
import { aPublishedQuestionnaire, useTestDatabase, type PublishedFixture } from "../../db/fixtures.js";
import { answersNo, answersYes, publishIntakeV2Relabel, seedIntakeV1 } from "../execution/fixtures.js";
import {
  aSessionAt,
  aSessionStartedAt,
  listSessionsUrl,
  sessionDetailUrl,
  startedSessionId,
  submitFixtureAnswers,
  type SessionTimes,
} from "./fixtures.js";
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

  it("pages by (startedAt desc, id) by default, with keyset cursors and no total count", async () => {
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
    expect(firstPage.previousCursor).toBeNull();
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = (
      await listSessions(published.questionnaireId, { cursor: presentCursor(firstPage.nextCursor) })
    ).json<SessionSummaryPage>();
    expect(secondPage.items.map((item) => item.sessionId)).toEqual(newestFirst.slice(RESPONSES_PAGE_SIZE));
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.previousCursor).not.toBeNull();

    const backToFirst = (
      await listSessions(published.questionnaireId, { cursor: presentCursor(secondPage.previousCursor) })
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
      await listSessions(published.questionnaireId, { cursor: presentCursor(firstPage.nextCursor) })
    ).json<SessionSummaryPage>();
    const firstIds = firstPage.items.map((item) => item.sessionId);
    const secondIds = secondPage.items.map((item) => item.sessionId);

    expect(firstIds).toEqual(newestFirst.slice(0, RESPONSES_PAGE_SIZE));
    expect(secondIds).toEqual(newestFirst.slice(RESPONSES_PAGE_SIZE));
    expect(secondIds.length).toBeGreaterThan(0);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(stored.length);
    expect(secondPage.nextCursor).toBeNull();

    const backToFirst = (
      await listSessions(published.questionnaireId, { cursor: presentCursor(secondPage.previousCursor) })
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

const ORDERINGS = [
  ["started", "asc"],
  ["started", "desc"],
  ["submitted", "asc"],
  ["submitted", "desc"],
] as const satisfies readonly (readonly [SessionSort, SortOrder])[];

const EPOCH = new Date("2026-09-01T00:00:00.000Z").getTime();

function minutes(count: number): Date {
  return new Date(EPOCH + count * 60_000);
}

interface StoredSession extends SessionTimes {
  readonly id: string;
}

async function storeSessions(published: PublishedFixture, times: readonly SessionTimes[]): Promise<StoredSession[]> {
  const execution = await testDatabase.connect("execution");
  const stored: StoredSession[] = [];
  for (const time of times) {
    stored.push({ ...time, id: await aSessionAt(execution, published, time) });
  }
  return stored;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function expectedOrder(stored: readonly StoredSession[], sort: SessionSort, order: SortOrder): string[] {
  const direction = order === "asc" ? 1 : -1;
  const valueOf = (entry: StoredSession) => (sort === "started" ? entry.startedAt : entry.submittedAt);
  return [...stored]
    .sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      if (left === null && right !== null) return 1;
      if (left !== null && right === null) return -1;
      const byValue = left === null || right === null ? 0 : left.getTime() - right.getTime();
      return byValue !== 0 ? direction * byValue : direction * compareIds(a.id, b.id);
    })
    .map((entry) => entry.id);
}

function idsOf(page: SessionSummaryPage): string[] {
  return page.items.map((item) => item.sessionId);
}

async function pageOf(questionnaireId: string, query: Record<string, string>): Promise<SessionSummaryPage> {
  const response = await listSessions(questionnaireId, query);
  expect(response.statusCode).toBe(200);
  return response.json<SessionSummaryPage>();
}

async function walkForward(questionnaireId: string, ordering: Record<string, string>): Promise<SessionSummaryPage[]> {
  const pages = [await pageOf(questionnaireId, ordering)];
  for (let next = pages[0]?.nextCursor; next !== null && next !== undefined; ) {
    const page = await pageOf(questionnaireId, { ...ordering, cursor: next });
    pages.push(page);
    next = page.nextCursor;
  }
  return pages;
}

async function walkBackward(questionnaireId: string, ordering: Record<string, string>, from: SessionSummaryPage): Promise<SessionSummaryPage[]> {
  const pages = [from];
  for (let previous = from.previousCursor; previous !== null; ) {
    const page = await pageOf(questionnaireId, { ...ordering, cursor: previous });
    pages.push(page);
    previous = page.previousCursor;
  }
  return pages;
}

const SUBMITTED_ON_THE_FIRST_PAGE: SessionTimes[] = [
  ...Array.from({ length: RESPONSES_PAGE_SIZE }, (_, i) => ({ startedAt: minutes(i), submittedAt: minutes(100 + (i % 7)) })),
  ...Array.from({ length: 15 }, (_, i) => ({ startedAt: minutes(200 + (i % 4)), submittedAt: null })),
];

const BOUNDARY_INSIDE_A_RUN_OF_EQUAL_TIMES: SessionTimes[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ startedAt: minutes(i), submittedAt: minutes(300 + i) })),
  ...Array.from({ length: 12 }, () => ({ startedAt: minutes(50), submittedAt: minutes(400) })),
  ...Array.from({ length: 5 }, (_, i) => ({ startedAt: minutes(60 + i), submittedAt: null })),
];

const BOUNDARY_INSIDE_THE_IN_PROGRESS_RUN: SessionTimes[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ startedAt: minutes(i), submittedAt: minutes(500 + i) })),
  ...Array.from({ length: 30 }, (_, i) => ({ startedAt: minutes(100 + (i % 3)), submittedAt: null })),
];

const TWO_FULL_PAGES_OF_SUBMITTED: SessionTimes[] = [
  ...Array.from({ length: 2 * RESPONSES_PAGE_SIZE }, (_, i) => ({ startedAt: minutes(i), submittedAt: minutes(600 + (i % 9)) })),
  ...Array.from({ length: 3 }, (_, i) => ({ startedAt: minutes(300 + i), submittedAt: null })),
];

const DATASETS: readonly (readonly [string, SessionTimes[]])[] = [
  ["a page boundary between the last submitted session and the first in-progress one", SUBMITTED_ON_THE_FIRST_PAGE],
  ["a page boundary inside a run of equal timestamps", BOUNDARY_INSIDE_A_RUN_OF_EQUAL_TIMES],
  ["a page boundary inside the run of in-progress sessions", BOUNDARY_INSIDE_THE_IN_PROGRESS_RUN],
];

const STATUSES = ["submitted", "in_progress"] as const;

const STATUS_DATASETS: readonly (readonly [string, SessionTimes[]])[] = [
  ...DATASETS,
  ["a page ending exactly on the last submitted session", TWO_FULL_PAGES_OF_SUBMITTED],
];

function inPages(ids: readonly string[]): string[][] {
  const pages: string[][] = [];
  for (let start = 0; start < ids.length; start += RESPONSES_PAGE_SIZE) {
    pages.push(ids.slice(start, start + RESPONSES_PAGE_SIZE));
  }
  return pages.length === 0 ? [[]] : pages;
}

describe("GET /questionnaires/:id/responses, sorted", () => {
  it("orders by every sort and order, with in-progress sessions after every submitted one under either submitted order", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const stored = await storeSessions(published, [
      { startedAt: minutes(5), submittedAt: minutes(9) },
      { startedAt: minutes(1), submittedAt: minutes(30) },
      { startedAt: minutes(3), submittedAt: null },
      { startedAt: minutes(4), submittedAt: minutes(9) },
      { startedAt: minutes(2), submittedAt: null },
      { startedAt: minutes(6), submittedAt: minutes(12) },
    ]);

    for (const [sort, order] of ORDERINGS) {
      const page = await pageOf(published.questionnaireId, { sort, order });

      expect(idsOf(page), `${sort} ${order}`).toEqual(expectedOrder(stored, sort, order));
      expect(page.previousCursor).toBeNull();
      expect(page.nextCursor).toBeNull();
    }
  });

  it("puts the in-progress sessions last for sort=submitted whichever way it runs, and orders them by id", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const stored = await storeSessions(published, [
      { startedAt: minutes(1), submittedAt: minutes(10) },
      { startedAt: minutes(2), submittedAt: null },
      { startedAt: minutes(3), submittedAt: minutes(20) },
      { startedAt: minutes(4), submittedAt: null },
    ]);
    const inProgress = stored.filter((entry) => entry.submittedAt === null).map((entry) => entry.id);

    const ascending = await pageOf(published.questionnaireId, { sort: "submitted", order: "asc" });
    const descending = await pageOf(published.questionnaireId, { sort: "submitted", order: "desc" });

    expect(idsOf(ascending).slice(2)).toEqual([...inProgress].sort(compareIds));
    expect(idsOf(descending).slice(2)).toEqual([...inProgress].sort(compareIds).reverse());
    expect(ascending.items.slice(0, 2).map((item) => item.status)).toEqual(["submitted", "submitted"]);
    expect(descending.items.slice(0, 2).map((item) => item.status)).toEqual(["submitted", "submitted"]);
    expect(descending.items.slice(0, 2).map((item) => item.submittedAt)).toEqual([minutes(20).toISOString(), minutes(10).toISOString()]);
  });

  it("defaults to started descending, and says so the same when the default is spelled out", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    await storeSessions(published, [
      { startedAt: minutes(1), submittedAt: minutes(50) },
      { startedAt: minutes(2), submittedAt: null },
      { startedAt: minutes(3), submittedAt: minutes(40) },
    ]);

    const implicit = await pageOf(published.questionnaireId, {});
    const explicit = await pageOf(published.questionnaireId, { sort: "started", order: "desc" });

    expect(idsOf(explicit)).toEqual(idsOf(implicit));
    expect(implicit.items.map((item) => item.startedAt)).toEqual([minutes(3), minutes(2), minutes(1)].map((at) => at.toISOString()));
  });

  it("sorts by the column alone when only sort is given, and by the default column when only order is", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const stored = await storeSessions(published, [
      { startedAt: minutes(1), submittedAt: minutes(50) },
      { startedAt: minutes(2), submittedAt: minutes(20) },
      { startedAt: minutes(3), submittedAt: minutes(40) },
    ]);

    expect(idsOf(await pageOf(published.questionnaireId, { sort: "submitted" }))).toEqual(expectedOrder(stored, "submitted", "desc"));
    expect(idsOf(await pageOf(published.questionnaireId, { order: "asc" }))).toEqual(expectedOrder(stored, "started", "asc"));
  });

  it.each(ORDERINGS.flatMap(([sort, order]) => DATASETS.map(([name, times]) => [sort, order, name, times] as const)))(
    "walks %s %s over %s forward and back with no session repeated or skipped",
    async (sort, order, _name, times) => {
      const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
      const stored = await storeSessions(published, times);
      const ordering = { sort, order };
      const expected = expectedOrder(stored, sort, order);

      const forward = await walkForward(published.questionnaireId, ordering);

      expect(forward.flatMap(idsOf)).toEqual(expected);
      expect(forward.every((page, index) => page.items.length === (index < forward.length - 1 ? RESPONSES_PAGE_SIZE : expected.length - index * RESPONSES_PAGE_SIZE))).toBe(true);
      expect(forward[0]?.previousCursor).toBeNull();
      expect(forward.slice(0, -1).every((page) => page.nextCursor !== null)).toBe(true);
      expect(forward.slice(1).every((page) => page.previousCursor !== null)).toBe(true);
      expect(forward.at(-1)?.nextCursor).toBeNull();

      const lastPage = forward.at(-1);
      if (lastPage === undefined) throw new Error("expected at least one page");
      const backward = await walkBackward(published.questionnaireId, ordering, lastPage);

      expect(backward.map(idsOf)).toEqual(forward.map(idsOf).reverse());
      expect(backward.at(-1)?.previousCursor).toBeNull();
    },
  );

  it.each(STATUS_DATASETS)(
    "walks every sort and order under each status over %s, forward and back, and the pages are exactly the expected order of that status",
    async (_name, times) => {
      const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
      const stored = await storeSessions(published, times);

      for (const [sort, order] of ORDERINGS) {
        for (const status of STATUSES) {
          const label = `${sort} ${order} ${status}`;
          const ordering = { sort, order, status };
          const expected = expectedOrder(
            stored.filter((entry) => (entry.submittedAt !== null) === (status === "submitted")),
            sort,
            order,
          );

          const forward = await walkForward(published.questionnaireId, ordering);

          expect(forward.map(idsOf), label).toEqual(inPages(expected));
          expect(forward.every((page) => page.items.every((item) => item.status === status)), label).toBe(true);
          expect(forward[0]?.previousCursor, label).toBeNull();
          expect(forward.at(-1)?.nextCursor, label).toBeNull();
          expect(forward.slice(0, -1).every((page) => page.nextCursor !== null), label).toBe(true);

          const lastPage = forward.at(-1);
          if (lastPage === undefined) throw new Error("expected at least one page");
          const backward = await walkBackward(published.questionnaireId, ordering, lastPage);

          expect(backward.map(idsOf), label).toEqual(forward.map(idsOf).reverse());
        }
      }
    },
  );

  it("reads a cursor anchored on the last submitted session under each status filter as the sessions after it, and one anchored on the first in-progress session as the sessions before it", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const stored = await storeSessions(published, TWO_FULL_PAGES_OF_SUBMITTED);
    const ordering = { sort: "submitted", order: "asc" } as const;
    const submitted = expectedOrder(stored.filter((entry) => entry.submittedAt !== null), "submitted", "asc");
    const inProgress = expectedOrder(stored.filter((entry) => entry.submittedAt === null), "submitted", "asc");

    const unfiltered = await walkForward(published.questionnaireId, ordering);
    const endsOnTheLastSubmitted = presentCursor(unfiltered[1]?.nextCursor ?? null);
    const startsOnTheFirstInProgress = presentCursor(unfiltered[2]?.previousCursor ?? null);

    const noneAfter = await pageOf(published.questionnaireId, { ...ordering, status: "submitted", cursor: endsOnTheLastSubmitted });
    const tailAfter = await pageOf(published.questionnaireId, { ...ordering, status: "in_progress", cursor: endsOnTheLastSubmitted });
    const submittedBefore = await pageOf(published.questionnaireId, { ...ordering, status: "submitted", cursor: startsOnTheFirstInProgress });
    const noneBefore = await pageOf(published.questionnaireId, { ...ordering, status: "in_progress", cursor: startsOnTheFirstInProgress });

    expect(unfiltered.map(idsOf)).toEqual(inPages([...submitted, ...inProgress]));
    expect(noneAfter).toEqual({ items: [], previousCursor: null, nextCursor: null });
    expect(idsOf(tailAfter)).toEqual(inProgress);
    expect(idsOf(submittedBefore)).toEqual(submitted.slice(-RESPONSES_PAGE_SIZE));
    expect(noneBefore).toEqual({ items: [], previousCursor: null, nextCursor: null });
  });

  it("takes a page anchored on the null boundary in both directions", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const stored = await storeSessions(published, SUBMITTED_ON_THE_FIRST_PAGE);
    const expected = expectedOrder(stored, "submitted", "asc");
    const ordering = { sort: "submitted", order: "asc" };

    const first = await pageOf(published.questionnaireId, ordering);
    const second = await pageOf(published.questionnaireId, { ...ordering, cursor: presentCursor(first.nextCursor) });
    const backToFirst = await pageOf(published.questionnaireId, { ...ordering, cursor: presentCursor(second.previousCursor) });

    expect(idsOf(first)).toEqual(expected.slice(0, RESPONSES_PAGE_SIZE));
    expect(first.items.every((item) => item.status === "submitted")).toBe(true);
    expect(idsOf(second)).toEqual(expected.slice(RESPONSES_PAGE_SIZE));
    expect(second.items.every((item) => item.status === "in_progress")).toBe(true);
    expect(idsOf(backToFirst)).toEqual(idsOf(first));
  });

  it("combines the status filter with every sort and order, so a page holds only that status and keeps its order", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const stored = await storeSessions(published, BOUNDARY_INSIDE_A_RUN_OF_EQUAL_TIMES);
    const submitted = stored.filter((entry) => entry.submittedAt !== null);
    const inProgress = stored.filter((entry) => entry.submittedAt === null);

    for (const [sort, order] of ORDERINGS) {
      const submittedPages = await walkForward(published.questionnaireId, { sort, order, status: "submitted" });
      const inProgressPages = await walkForward(published.questionnaireId, { sort, order, status: "in_progress" });

      expect(submittedPages.flatMap(idsOf), `${sort} ${order} submitted`).toEqual(expectedOrder(submitted, sort, order));
      expect(inProgressPages.flatMap(idsOf), `${sort} ${order} in progress`).toEqual(expectedOrder(inProgress, sort, order));
    }
  });

  it("filters by version while sorting, so the other version's sessions never enter the walk", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const stored = await storeSessions(published, SUBMITTED_ON_THE_FIRST_PAGE);

    const pages = await walkForward(published.questionnaireId, { sort: "submitted", order: "desc", version: String(published.version) });
    const none = await pageOf(published.questionnaireId, { sort: "submitted", order: "desc", version: String(published.version + 1) });

    expect(pages.flatMap(idsOf)).toEqual(expectedOrder(stored, "submitted", "desc"));
    expect(none.items).toEqual([]);
  });

  describe("a cursor issued under another ordering", () => {
    async function aSecondPageCursor(published: PublishedFixture, ordering: Record<string, string>): Promise<string> {
      const first = await pageOf(published.questionnaireId, ordering);
      return presentCursor(first.nextCursor);
    }

    it("is not honoured under another sort column, the opposite order or no ordering at all: the page is that ordering's first page, never a Postgres error", async () => {
      const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
      const stored = await storeSessions(published, SUBMITTED_ON_THE_FIRST_PAGE);
      const cursor = await aSecondPageCursor(published, { sort: "submitted", order: "asc" });
      const others: [SessionSort, SortOrder, Record<string, string>][] = [
        ["started", "asc", { sort: "started", order: "asc" }],
        ["submitted", "desc", { sort: "submitted", order: "desc" }],
        ["started", "desc", {}],
      ];

      for (const [sort, order, other] of others) {
        const response = await listSessions(published.questionnaireId, { ...other, cursor });
        const page = response.json<SessionSummaryPage>();

        expect(response.statusCode).toBe(200);
        expect(idsOf(page), `${sort} ${order}`).toEqual(expectedOrder(stored, sort, order).slice(0, RESPONSES_PAGE_SIZE));
        expect(page.previousCursor).toBeNull();
      }
    });

    it("is honoured under the ordering it was issued for", async () => {
      const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
      const stored = await storeSessions(published, SUBMITTED_ON_THE_FIRST_PAGE);
      const ordering = { sort: "submitted", order: "asc" };

      const page = await pageOf(published.questionnaireId, { ...ordering, cursor: await aSecondPageCursor(published, ordering) });

      expect(idsOf(page)).toEqual(expectedOrder(stored, "submitted", "asc").slice(RESPONSES_PAGE_SIZE));
    });
  });

  it("answers 200 rather than an error for a forged cursor: not a cursor at all, well-formed for a session that does not exist, carrying SQL in its sort, or with an impossible timestamp", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    await storeSessions(published, SUBMITTED_ON_THE_FIRST_PAGE);
    const absent = "00000000-0000-4000-8000-000000000000";
    const forged = [
      "not-a-cursor",
      Buffer.from(`forward|submitted|desc|null|${absent}`).toString("base64url"),
      Buffer.from(`forward|submitted; DROP TABLE x|desc|null|${absent}`).toString("base64url"),
      Buffer.from(`forward|submitted|desc|2026-02-31T25:61:61.000Z|${absent}`).toString("base64url"),
    ];

    for (const cursor of forged) {
      const response = await listSessions(published.questionnaireId, { sort: "submitted", order: "desc", cursor });

      expect(response.statusCode, cursor).toBe(200);
    }
  });

  it("rejects an unknown sort or order, or one carrying SQL, with 400 before it reaches the database", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const unacceptable: Record<string, string>[] = [{ sort: "id" }, { order: "sideways" }, { sort: "started_at; select 1" }, { order: "desc, id" }];

    for (const query of unacceptable) {
      const response = await listSessions(published.questionnaireId, query);

      expect(response.statusCode, JSON.stringify(query)).toBe(400);
      expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    }
  });
});
