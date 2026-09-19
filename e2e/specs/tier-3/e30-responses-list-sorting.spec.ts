import { RESPONSES_PAGE_SIZE } from "@qp/shared";
import { expect, test, type SessionTimes } from "../../fixtures/index";
import { anOptionalItemQuestionnaire, minutesAfterEpoch, shortIdsInOrder, timedSessions } from "./support/timed-sessions";

const FOUR_SESSIONS: SessionTimes[] = [
  { startedAt: minutesAfterEpoch(0), submittedAt: minutesAfterEpoch(30) },
  { startedAt: minutesAfterEpoch(10), submittedAt: minutesAfterEpoch(20) },
  { startedAt: minutesAfterEpoch(20), submittedAt: null },
  { startedAt: minutesAfterEpoch(30), submittedAt: minutesAfterEpoch(40) },
];

const STARTED_DESC = [3, 2, 1, 0];
const STARTED_ASC = [0, 1, 2, 3];
const SUBMITTED_DESC = [3, 0, 1, 2];
const SUBMITTED_ASC = [1, 0, 3, 2];

test.describe("E30 — the responses list sorts by the Started and Submitted timestamps, and the session screen follows that order", () => {
  test("the column headers reorder the rows both ways, an in-progress session sorts last by Submitted either way, and the URL holds only a non-default sort", async ({
    api,
    execution,
    db,
    admin,
    page,
  }) => {
    const published = await anOptionalItemQuestionnaire(api, "E30 sorting");
    const questionnaireId = published.questionnaire.questionnaireId;
    const sessions = await timedSessions(execution, db, questionnaireId, FOUR_SESSIONS);
    const rowOrder = () => admin.sessionIdsInRowOrder();

    await admin.openResponsesList(questionnaireId);
    await expect.poll(rowOrder).toEqual(shortIdsInOrder(sessions, STARTED_DESC));
    await expect(admin.sortHeader("Started")).toHaveAttribute("aria-sort", "descending");
    await expect(admin.sortHeader("Submitted")).not.toHaveAttribute("aria-sort");

    await admin.sortButton("Started").click();
    await expect.poll(rowOrder).toEqual(shortIdsInOrder(sessions, STARTED_ASC));
    await expect(admin.sortHeader("Started")).toHaveAttribute("aria-sort", "ascending");
    await expect(page).toHaveURL(/[?&]order=asc(&|$)/);
    await expect(page).not.toHaveURL(/sort=/);

    await admin.sortButton("Submitted").click();
    await expect.poll(rowOrder).toEqual(shortIdsInOrder(sessions, SUBMITTED_DESC));
    await expect(admin.sortButton("Submitted")).toBeFocused();
    await expect(admin.sortHeader("Submitted")).toHaveAttribute("aria-sort", "descending");
    await expect(admin.sortHeader("Started")).not.toHaveAttribute("aria-sort");
    await expect(page).toHaveURL(/[?&]sort=submitted(&|$)/);
    await expect(page).not.toHaveURL(/order=/);
    await expect(admin.sessionRow(sessions[2]?.sessionId ?? "")).toContainText("In progress");

    await admin.sortButton("Submitted").click();
    await expect.poll(rowOrder).toEqual(shortIdsInOrder(sessions, SUBMITTED_ASC));
    await expect(admin.sortHeader("Submitted")).toHaveAttribute("aria-sort", "ascending");
    await expect(page).toHaveURL(/sort=submitted/);
    await expect(page).toHaveURL(/order=asc/);

    await admin.sortButton("Started").click();
    await expect.poll(rowOrder).toEqual(shortIdsInOrder(sessions, STARTED_DESC));
    await expect(admin.sortHeader("Started")).toHaveAttribute("aria-sort", "descending");
    await expect(page).not.toHaveURL(/sort=|order=/);
  });

  test("sorted by Submitted, the pages walk every session once, across the boundary between the last submitted session and the first in-progress one", async ({
    api,
    execution,
    db,
    admin,
    page,
  }) => {
    const published = await anOptionalItemQuestionnaire(api, "E30 paging");
    const questionnaireId = published.questionnaire.questionnaireId;
    const submittedCount = RESPONSES_PAGE_SIZE - 1;
    const inProgressCount = 3;
    const times: SessionTimes[] = [
      ...Array.from({ length: submittedCount }, (_, i) => ({ startedAt: minutesAfterEpoch(i), submittedAt: minutesAfterEpoch(1000 - i) })),
      ...Array.from({ length: inProgressCount }, (_, i) => ({ startedAt: minutesAfterEpoch(500 + i), submittedAt: null })),
    ];
    const sessions = await timedSessions(execution, db, questionnaireId, times);
    const submittedAscending = sessions.slice(0, submittedCount).reverse().map((entry) => entry.shortId);
    const inProgressById = sessions
      .slice(submittedCount)
      .map((entry) => entry.sessionId)
      .sort()
      .map((sessionId) => sessionId.slice(0, 8));
    const expectedWalk = [...submittedAscending, ...inProgressById];

    await admin.openResponsesList(questionnaireId, { sort: "submitted", order: "asc" });
    await expect(admin.nextPageButton()).toBeEnabled();
    const firstPage = await admin.sessionIdsInRowOrder();
    expect(firstPage).toEqual(expectedWalk.slice(0, RESPONSES_PAGE_SIZE));
    expect(firstPage.slice(0, submittedCount)).toEqual(submittedAscending);
    expect(inProgressById).toContain(firstPage.at(-1));

    await admin.nextPageButton().click();
    await expect(page.getByText(`${inProgressCount - 1} sessions on this page`, { exact: true })).toBeVisible();
    const secondPage = await admin.sessionIdsInRowOrder();
    expect(secondPage).toEqual(expectedWalk.slice(RESPONSES_PAGE_SIZE));
    await expect(admin.nextPageButton()).toBeDisabled();
    await expect(admin.sortHeader("Submitted")).toHaveAttribute("aria-sort", "ascending");

    await admin.previousPageButton().click();
    await expect(page.getByText(`${RESPONSES_PAGE_SIZE} sessions on this page`, { exact: true })).toBeVisible();
    await expect.poll(() => admin.sessionIdsInRowOrder()).toEqual(firstPage);
  });

  test("changing the sort while on a later page returns to the first page of the new order, keeping the status filter", async ({
    api,
    execution,
    db,
    admin,
    page,
  }) => {
    const published = await anOptionalItemQuestionnaire(api, "E30 reset");
    const questionnaireId = published.questionnaire.questionnaireId;
    const times: SessionTimes[] = Array.from({ length: RESPONSES_PAGE_SIZE + 2 }, (_, i) => ({
      startedAt: minutesAfterEpoch(i),
      submittedAt: minutesAfterEpoch(200 - i),
    }));
    const sessions = await timedSessions(execution, db, questionnaireId, times);

    await admin.openResponsesList(questionnaireId, { status: "submitted" });
    await admin.nextPageButton().click();
    await expect(page).toHaveURL(/cursor=/);

    await admin.sortButton("Submitted").click();
    await expect(page).not.toHaveURL(/cursor=/);
    await expect(page).toHaveURL(/status=submitted/);
    await expect(page).toHaveURL(/sort=submitted/);
    const newestSubmittedFirst = [...sessions].sort((a, b) => (b.times.submittedAt?.getTime() ?? 0) - (a.times.submittedAt?.getTime() ?? 0));
    await expect
      .poll(() => admin.sessionIdsInRowOrder())
      .toEqual(newestSubmittedFirst.slice(0, RESPONSES_PAGE_SIZE).map((entry) => entry.shortId));
  });

  test("a session opened from a sorted list steps to its neighbours in that order, and goes back to the same sort", async ({
    api,
    execution,
    db,
    admin,
    page,
  }) => {
    const published = await anOptionalItemQuestionnaire(api, "E30 detail");
    const questionnaireId = published.questionnaire.questionnaireId;
    const sessions = await timedSessions(execution, db, questionnaireId, FOUR_SESSIONS);
    const [first, second, third, fourth] = shortIdsInOrder(sessions, SUBMITTED_ASC);

    await admin.openResponsesList(questionnaireId, { sort: "submitted", order: "asc" });
    await expect.poll(() => admin.sessionIdsInRowOrder()).toEqual([first, second, third, fourth]);

    await page.getByRole("link", { name: `Open session ${first}`, exact: true }).click();
    await expect(admin.sessionPanel()).toContainText(first ?? "");
    await expect(page).toHaveURL(/sort=submitted/);
    await expect(page).toHaveURL(/order=asc/);
    await expect(admin.previousSessionButton()).toBeDisabled();

    await admin.nextSessionButton().click();
    await expect(admin.sessionPanel()).toContainText(second ?? "");
    await admin.nextSessionButton().click();
    await expect(admin.sessionPanel()).toContainText(third ?? "");
    await admin.nextSessionButton().click();
    await expect(admin.sessionPanel()).toContainText(fourth ?? "");
    await expect(admin.sessionPanel()).toContainText("In progress");
    await expect(admin.nextSessionButton()).toBeDisabled();

    await admin.previousSessionButton().click();
    await expect(admin.sessionPanel()).toContainText(third ?? "");

    await page.getByRole("link", { name: "Back to responses" }).click();
    await expect(admin.sortHeader("Submitted")).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(() => admin.sessionIdsInRowOrder()).toEqual([first, second, third, fourth]);
  });
});
