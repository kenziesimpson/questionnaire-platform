import {
  createDemoShapedQuestionnaire,
  DEMO_OPTION_IDS,
  DEMO_V1,
  DEMO_V2,
  expect,
  publishDemoHypertensionRelabel,
  test,
  uniqueName,
} from "../../fixtures/index";
import { openRespondentBrowser } from "./support/respondent-browser";

const prompts = DEMO_V1.prompts;
const YES = DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes);
const V1_HYPERTENSION = DEMO_V1.optionLabel(DEMO_OPTION_IDS.hypertension);
const V2_HYPERTENSION = DEMO_V2.optionLabel(DEMO_OPTION_IDS.hypertension);

test.describe("E28 — the admin session-detail screen keeps a session's pinned version after a republish", () => {
  test("a session started on v1 still shows v1's question and option labels once v2 is published, and a v2 session shows the new label", async ({
    page,
    secondContext,
    api,
    admin,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api, { name: uniqueName("E28 pin") });

    const sessionA = await openRespondentBrowser(secondContext);
    await sessionA.respondent.openForm(demo.questionnaireId);
    await sessionA.respondent.choose(prompts.hasCondition, YES);
    await sessionA.respondent.choose(prompts.whichCondition, V1_HYPERTENSION);
    await sessionA.respondent.fillDate(prompts.diagnosedOn, "2015-01-20");
    await sessionA.respondent.fillText(prompts.pharmacy, "Session A pharmacy");
    const receiptA = await sessionA.respondent.submitAndExpectReceipt();
    await sessionA.context.close();

    await publishDemoHypertensionRelabel(api, demo);

    const sessionB = await openRespondentBrowser(secondContext);
    await sessionB.respondent.openForm(demo.questionnaireId);
    await sessionB.respondent.choose(prompts.hasCondition, YES);
    await sessionB.respondent.choose(prompts.whichCondition, V2_HYPERTENSION);
    await sessionB.respondent.fillDate(prompts.diagnosedOn, "2016-02-11");
    await sessionB.respondent.fillText(prompts.pharmacy, "Session B pharmacy");
    const receiptB = await sessionB.respondent.submitAndExpectReceipt();
    await sessionB.context.close();

    await admin.openResponseDetail(demo.questionnaireId, receiptA.sessionId);
    await expect(page.getByText(`${DEMO_V1.title} · version 1`, { exact: true })).toBeVisible();
    const pinNote = page.getByRole("note");
    await expect(pinNote).toContainText("pinned to version 1");
    await expect(pinNote).toContainText("moved to version 2");

    const whichConditionA = page.getByRole("listitem").filter({ hasText: prompts.whichCondition });
    await expect(whichConditionA.getByText(V1_HYPERTENSION, { exact: true })).toBeVisible();
    await expect(whichConditionA.getByText(V2_HYPERTENSION, { exact: true })).toHaveCount(0);

    await admin.openResponseDetail(demo.questionnaireId, receiptB.sessionId);
    await expect(page.getByText(`${DEMO_V2.title} · version 2`, { exact: true })).toBeVisible();
    await expect(page.getByRole("note")).toHaveCount(0);

    const whichConditionB = page.getByRole("listitem").filter({ hasText: prompts.whichCondition });
    await expect(whichConditionB.getByText(V2_HYPERTENSION, { exact: true })).toBeVisible();
    await expect(whichConditionB.getByText(V1_HYPERTENSION, { exact: true })).toHaveCount(0);
  });
});
