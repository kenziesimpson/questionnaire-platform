import { RESPONSES_PAGE_SIZE, reportingApi } from "@qp/shared";
import { expect, recordRequests, test, type SessionTimes } from "../../fixtures/index";
import { anOptionalItemQuestionnaire, minutesAfterEpoch, shortIdsInOrder, timedSessions } from "./support/timed-sessions";

const SEEDED_COUNT = RESPONSES_PAGE_SIZE + 3;
const QUIET_PERIOD = "15:00";

const NEWEST_FIRST = Array.from({ length: SEEDED_COUNT }, (_, index) => SEEDED_COUNT - 1 - index);
const FIRST_PAGE = NEWEST_FIRST.slice(0, RESPONSES_PAGE_SIZE);
const OLDER_PAGE = NEWEST_FIRST.slice(RESPONSES_PAGE_SIZE);

const SEEDED_TIMES: SessionTimes[] = Array.from({ length: SEEDED_COUNT }, (_, index) => ({
  startedAt: minutesAfterEpoch(index),
  submittedAt: null,
}));
const NEWCOMER_TIMES: SessionTimes = { startedAt: minutesAfterEpoch(SEEDED_COUNT + 100), submittedAt: null };

test.describe("E31 — a session that arrives while the responses list is being paged is met by a plain keyset walk, not by anything clever", () => {
  test("a newcomer does not refresh the page on screen, shifts neither Next nor Previous, and waits one page further back until the list is reloaded", async ({
    api,
    execution,
    db,
    admin,
    page,
  }) => {
    const published = await anOptionalItemQuestionnaire(api, "E31 new arrivals");
    const questionnaireId = published.questionnaire.questionnaireId;
    const sessions = await timedSessions(execution, db, questionnaireId, SEEDED_TIMES);
    const originalFirstPage = shortIdsInOrder(sessions, FIRST_PAGE);
    const originalOlderPage = shortIdsInOrder(sessions, OLDER_PAGE);

    await page.clock.install();
    const listRequests = recordRequests(
      page,
      (request) => request.method() === "GET" && new URL(request.url()).pathname === `${reportingApi.REPORTING_PREFIX}/questionnaires/${questionnaireId}/responses`,
    );

    await admin.openResponsesList(questionnaireId);
    await expect(page.getByText(`${RESPONSES_PAGE_SIZE} sessions on this page`, { exact: true })).toBeVisible();
    await expect.poll(() => admin.sessionIdsInRowOrder()).toEqual(originalFirstPage);
    await expect(admin.nextPageButton()).toBeEnabled();
    await expect(admin.previousPageButton()).toBeDisabled();
    expect(listRequests).toHaveLength(1);

    const { session: newcomer } = await execution.createSession(questionnaireId);
    await db.setSessionTimes(newcomer.sessionId, NEWCOMER_TIMES);
    const newcomerId = newcomer.sessionId.slice(0, 8);

    await page.clock.fastForward(QUIET_PERIOD);
    await page.waitForLoadState("networkidle");
    expect(listRequests).toHaveLength(1);
    await expect(page.getByText(`${RESPONSES_PAGE_SIZE} sessions on this page`, { exact: true })).toBeVisible();
    expect(await admin.sessionIdsInRowOrder()).toEqual(originalFirstPage);
    await expect(admin.openSessionButton(newcomer.sessionId)).toHaveCount(0);

    await admin.nextPageButton().click();
    await expect(page.getByText(`${OLDER_PAGE.length} sessions on this page`, { exact: true })).toBeVisible();
    expect(listRequests).toHaveLength(2);
    const walkedOlderPage = await admin.sessionIdsInRowOrder();
    expect(walkedOlderPage).toEqual(originalOlderPage);
    expect(walkedOlderPage.some((id) => originalFirstPage.includes(id) || id === newcomerId)).toBe(false);
    expect([...originalFirstPage, ...walkedOlderPage]).toEqual(shortIdsInOrder(sessions, NEWEST_FIRST));
    await expect(admin.nextPageButton()).toBeDisabled();
    await expect(admin.previousPageButton()).toBeEnabled();

    await admin.previousPageButton().click();
    await expect(page.getByText(`${RESPONSES_PAGE_SIZE} sessions on this page`, { exact: true })).toBeVisible();
    await expect.poll(() => admin.sessionIdsInRowOrder()).toEqual(originalFirstPage);
    await expect(admin.previousPageButton()).toBeEnabled();
    await expect(admin.nextPageButton()).toBeEnabled();

    await admin.previousPageButton().click();
    await expect(page.getByText("1 session on this page", { exact: true })).toBeVisible();
    await expect.poll(() => admin.sessionIdsInRowOrder()).toEqual([newcomerId]);
    await expect(admin.previousPageButton()).toBeDisabled();
    await expect(admin.nextPageButton()).toBeEnabled();

    await admin.openResponsesList(questionnaireId);
    await expect(page.getByText(`${RESPONSES_PAGE_SIZE} sessions on this page`, { exact: true })).toBeVisible();
    await expect.poll(() => admin.sessionIdsInRowOrder()).toEqual([newcomerId, ...originalFirstPage.slice(0, RESPONSES_PAGE_SIZE - 1)]);
    await expect(admin.previousPageButton()).toBeDisabled();

    await admin.nextPageButton().click();
    await expect(page.getByText(`${OLDER_PAGE.length + 1} sessions on this page`, { exact: true })).toBeVisible();
    await expect
      .poll(() => admin.sessionIdsInRowOrder())
      .toEqual([originalFirstPage[RESPONSES_PAGE_SIZE - 1], ...originalOlderPage]);
  });
});
