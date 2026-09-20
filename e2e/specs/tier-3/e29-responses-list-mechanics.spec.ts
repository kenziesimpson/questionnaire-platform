import { RESPONSES_PAGE_SIZE } from "@qp/shared";
import { createDemoShapedQuestionnaire, expect, publishDemoHypertensionRelabel, test, uniqueName } from "../../fixtures/index";
import { textQuestionInput } from "./support/question-input";

function aCursorPastTheEndOfTheDefaultOrder(): string {
  return Buffer.from("forward|started|desc|1970-01-01T00:00:00.000Z|00000000-0000-4000-8000-000000000000", "utf8").toString("base64url");
}

test.describe("E29 — the responses list's Previous/Next paging and version filter actually change what's shown", () => {
  test("Next then Previous swaps between two disjoint pages of the same size the page reports", async ({ api, execution, admin, page }) => {
    const question = await api.createQuestion(textQuestionInput("E29 paging note"));
    const published = await api.createPublishedQuestionnaire({ name: uniqueName("E29 paging"), title: "Paging fixture" }, [
      { itemId: "itm_note", question },
    ]);
    const questionnaireId = published.questionnaire.questionnaireId;

    const extra = 2;
    await Promise.all(
      Array.from({ length: RESPONSES_PAGE_SIZE + extra }, () => execution.createSession(questionnaireId)),
    );

    await admin.openResponsesList(questionnaireId);
    await expect(page.getByText(`${RESPONSES_PAGE_SIZE} sessions on this page`, { exact: true })).toBeVisible();
    await expect(admin.nextPageButton()).toBeEnabled();
    await expect(admin.previousPageButton()).toBeDisabled();
    const firstPageIds = await admin.sessionIdsInRowOrder();
    expect(firstPageIds).toHaveLength(RESPONSES_PAGE_SIZE);

    await admin.nextPageButton().click();
    await expect(page.getByText(`${extra} sessions on this page`, { exact: true })).toBeVisible();
    await expect(admin.previousPageButton()).toBeEnabled();
    await expect(admin.nextPageButton()).toBeDisabled();
    const secondPageIds = await admin.sessionIdsInRowOrder();
    expect(secondPageIds).toHaveLength(extra);
    expect(secondPageIds.some((id) => firstPageIds.includes(id))).toBe(false);

    await admin.previousPageButton().click();
    await expect(page.getByText(`${RESPONSES_PAGE_SIZE} sessions on this page`, { exact: true })).toBeVisible();
    const backToFirstPageIds = await admin.sessionIdsInRowOrder();
    expect(backToFirstPageIds).toEqual(firstPageIds);
  });

  test("the version filter shows only sessions pinned to the chosen version", async ({ api, execution, admin }) => {
    const demo = await createDemoShapedQuestionnaire(api, { name: uniqueName("E29 version filter") });
    const v1Session = await execution.createSession(demo.questionnaireId);
    await publishDemoHypertensionRelabel(api, demo);
    const v2Session = await execution.createSession(demo.questionnaireId);

    await admin.openResponsesList(demo.questionnaireId);
    await expect(admin.sessionRow(v1Session.session.sessionId)).toBeVisible();
    await expect(admin.sessionRow(v2Session.session.sessionId)).toBeVisible();

    await admin.versionFilter().selectOption("1");
    await expect(admin.sessionRow(v1Session.session.sessionId)).toBeVisible();
    await expect(admin.sessionRow(v2Session.session.sessionId)).toHaveCount(0);

    await admin.versionFilter().selectOption("2");
    await expect(admin.sessionRow(v2Session.session.sessionId)).toBeVisible();
    await expect(admin.sessionRow(v1Session.session.sessionId)).toHaveCount(0);

    await admin.versionFilter().selectOption("");
    await expect(admin.sessionRow(v1Session.session.sessionId)).toBeVisible();
    await expect(admin.sessionRow(v2Session.session.sessionId)).toBeVisible();
  });

  test("a cursor past the end of the list shows an empty page with a way back to the first page, not a dead end", async ({
    api,
    execution,
    admin,
    page,
  }) => {
    const question = await api.createQuestion(textQuestionInput("E29 past the end note"));
    const published = await api.createPublishedQuestionnaire({ name: uniqueName("E29 past the end"), title: "Past the end fixture" }, [
      { itemId: "itm_note", question },
    ]);
    const questionnaireId = published.questionnaire.questionnaireId;
    await Promise.all([execution.createSession(questionnaireId), execution.createSession(questionnaireId)]);

    await admin.openResponsesList(questionnaireId, { cursor: aCursorPastTheEndOfTheDefaultOrder() });
    await expect(page.getByRole("cell", { name: /There are no sessions on this page/ })).toBeVisible();
    await expect(page.getByText("No sessions match these filters.")).toHaveCount(0);
    await expect(admin.nextPageButton()).toBeDisabled();
    await expect(admin.previousPageButton()).toBeDisabled();

    await admin.backToFirstPageButton().click();
    await expect(page).not.toHaveURL(/cursor=/);
    await expect.poll(() => admin.sessionIdsInRowOrder()).toHaveLength(2);
    await expect(admin.backToFirstPageButton()).toHaveCount(0);
  });
});
