import type { Page } from "@playwright/test";
import { RESPONSES_PAGE_SIZE } from "@qp/shared";
import { createDemoShapedQuestionnaire, expect, publishDemoHypertensionRelabel, test, uniqueName } from "../../fixtures/index";
import { textQuestionInput } from "./support/question-input";

async function openSessionIdsShown(page: Page): Promise<string[]> {
  const links = await page.getByRole("link", { name: /^Open session /, exact: false }).all();
  const labels = await Promise.all(links.map((link) => link.getAttribute("aria-label")));
  return labels.map((label) => (label ?? "").replace("Open session ", ""));
}

test.describe("E29 — the responses list's Newer/Older paging and version filter actually change what's shown", () => {
  test("Older then Newer swaps between two disjoint pages of the same size the page reports", async ({ api, execution, admin, page }) => {
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
    await expect(admin.olderPageButton()).toBeEnabled();
    await expect(admin.newerPageButton()).toBeDisabled();
    const firstPageIds = await openSessionIdsShown(page);
    expect(firstPageIds).toHaveLength(RESPONSES_PAGE_SIZE);

    await admin.olderPageButton().click();
    await expect(page.getByText(`${extra} sessions on this page`, { exact: true })).toBeVisible();
    await expect(admin.newerPageButton()).toBeEnabled();
    await expect(admin.olderPageButton()).toBeDisabled();
    const secondPageIds = await openSessionIdsShown(page);
    expect(secondPageIds).toHaveLength(extra);
    expect(secondPageIds.some((id) => firstPageIds.includes(id))).toBe(false);

    await admin.newerPageButton().click();
    await expect(page.getByText(`${RESPONSES_PAGE_SIZE} sessions on this page`, { exact: true })).toBeVisible();
    const backToFirstPageIds = await openSessionIdsShown(page);
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
});
