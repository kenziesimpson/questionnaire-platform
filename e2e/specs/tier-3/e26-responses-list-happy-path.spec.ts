import {
  ADMIN_HEADINGS,
  createDemoShapedQuestionnaire,
  DEMO_OPTION_IDS,
  DEMO_V1,
  expect,
  RespondentPage,
  test,
  uniqueName,
} from "../../fixtures/index";

const prompts = DEMO_V1.prompts;
const YES = DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes);
const HYPERTENSION = DEMO_V1.optionLabel(DEMO_OPTION_IDS.hypertension);

test.describe("E26 — the admin responses screens show a real submitted session, reachable from both tie-in links", () => {
  test("an empty questionnaire shows no sessions, both tie-in links reach the list, and a genuine submission renders in the list and in its own detail screen", async ({
    page,
    secondContext,
    api,
    admin,
  }) => {
    const name = uniqueName("E26 responses");
    const demo = await createDemoShapedQuestionnaire(api, { name });

    await admin.openQuestionnaires();
    await admin.responsesLink(name).click();
    await expect(admin.heading(ADMIN_HEADINGS.responses)).toBeVisible();
    await expect(page.getByText("No sessions yet.", { exact: true })).toBeVisible();
    await expect(page.getByText("Raw · not aggregated", { exact: true })).toBeVisible();

    await admin.openVersionHistory(demo.questionnaireId);
    await admin.rawResponsesLink().click();
    await expect(admin.heading(ADMIN_HEADINGS.responses)).toBeVisible();
    await expect(page.getByText("No sessions yet.", { exact: true })).toBeVisible();

    const respondentContext = await secondContext();
    const respondentPage = await respondentContext.newPage();
    const respondent = new RespondentPage(respondentPage);
    await respondent.openForm(demo.questionnaireId);
    await respondent.choose(prompts.hasCondition, YES);
    await respondent.choose(prompts.whichCondition, HYPERTENSION);
    await respondent.fillDate(prompts.diagnosedOn, "2015-01-20");
    await respondent.fillText(prompts.pharmacy, "Corner pharmacy");
    const receipt = await respondent.submitAndExpectReceipt();
    await respondentContext.close();

    await admin.openResponsesList(demo.questionnaireId);
    const row = admin.sessionRow(receipt.sessionId);
    await expect(row).toBeVisible();
    await expect(row).toContainText("v1");
    await expect(row).toContainText("Submitted");
    await expect(row).toContainText("4 of 4");

    await admin.openSessionButton(receipt.sessionId).click();
    await expect(admin.sessionPanel()).toContainText(receipt.sessionId);
    await expect(admin.sessionPanel()).toContainText("4 of 4 questions");
    await expect(page.getByText(`${DEMO_V1.title} · version 1`, { exact: true })).toBeVisible();

    const hasConditionItem = page.getByRole("listitem").filter({ hasText: prompts.hasCondition });
    await expect(hasConditionItem.getByText(YES, { exact: true })).toBeVisible();

    const whichConditionItem = page.getByRole("listitem").filter({ hasText: prompts.whichCondition });
    await expect(whichConditionItem.getByText(HYPERTENSION, { exact: true })).toBeVisible();

    const diagnosedOnItem = page.getByRole("listitem").filter({ hasText: prompts.diagnosedOn });
    await expect(diagnosedOnItem).toContainText("2015-01-20");

    const pharmacyItem = page.getByRole("listitem").filter({ hasText: prompts.pharmacy });
    await expect(pharmacyItem.getByText("Corner pharmacy", { exact: true })).toBeVisible();
  });
});
