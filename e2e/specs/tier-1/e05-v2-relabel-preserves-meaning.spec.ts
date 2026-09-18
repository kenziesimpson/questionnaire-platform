import {
  ADMIN_HEADINGS,
  createDemoShapedQuestionnaire,
  DEMO_ITEM_IDS,
  DEMO_OPTION_IDS,
  DEMO_V1,
  DEMO_V2,
  expect,
  test,
  type RespondentPage,
} from "../../fixtures/index.ts";
import { DraftAuthoring } from "./support/draft-authoring.ts";
import { openRespondentBrowser } from "./support/respondent-browser.ts";

const prompts = DEMO_V1.prompts;
const YES = DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes);
const V1_HYPERTENSION = DEMO_V1.optionLabel(DEMO_OPTION_IDS.hypertension);
const V2_HYPERTENSION = DEMO_V2.optionLabel(DEMO_OPTION_IDS.hypertension);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function leadingLabel(label: string): RegExp {
  return new RegExp(`^${escapeRegExp(label)}`);
}

async function submitHypertension(respondent: RespondentPage, hypertensionLabel: string, pharmacy: string): Promise<string> {
  await respondent.choose(prompts.hasCondition, YES);
  await respondent.choose(prompts.whichCondition, hypertensionLabel);
  await respondent.fillDate(prompts.diagnosedOn, "2015-01-20");
  await respondent.fillText(prompts.pharmacy, pharmacy);
  return (await respondent.submitAndExpectReceipt()).sessionId;
}

test.describe("E5 — a v2 relabel preserves collected meaning", () => {
  test("relabelling an option in a v2 draft leaves v1 responses untouched and both versions record the same option id", async ({
    page,
    secondContext,
    api,
    db,
    admin,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api, { name: "E5 relabel" });
    const whichConditionQuestionId = demo.questions.whichCondition.questionId;

    const sessionA = await openRespondentBrowser(secondContext);
    await sessionA.respondent.openForm(demo.questionnaireId);
    await expect(sessionA.respondent.option(prompts.whichCondition, V2_HYPERTENSION)).toHaveCount(0);
    const sessionAId = await submitHypertension(sessionA.respondent, V1_HYPERTENSION, "Session A pharmacy");
    await sessionA.context.close();
    const responsesOfABefore = await db.responsesFor(sessionAId);
    expect(responsesOfABefore.find((response) => response.itemId === DEMO_ITEM_IDS.whichCondition)).toMatchObject({
      questionId: whichConditionQuestionId,
      questionVersion: 1,
      questionnaireVersion: 1,
      optionIds: [DEMO_OPTION_IDS.hypertension],
    });

    await admin.openVersionHistory(demo.questionnaireId);
    await page.getByRole("button", { name: "Open the next draft", exact: true }).click();
    const authoring = new DraftAuthoring(page);
    await expect(authoring.draftItem(2)).toContainText(prompts.whichCondition);
    await authoring.relabelOption(2, DEMO_OPTION_IDS.hypertension, V2_HYPERTENSION, 2);
    await authoring.publish(2);

    const sessionB = await openRespondentBrowser(secondContext);
    await sessionB.respondent.openForm(demo.questionnaireId);
    await sessionB.respondent.choose(prompts.hasCondition, YES);
    await expect(sessionB.respondent.option(prompts.whichCondition, V2_HYPERTENSION)).toBeVisible();
    await expect(sessionB.respondent.option(prompts.whichCondition, V1_HYPERTENSION)).toHaveCount(0);
    const sessionBId = await submitHypertension(sessionB.respondent, V2_HYPERTENSION, "Session B pharmacy");
    await sessionB.context.close();

    expect(await db.responsesFor(sessionAId)).toEqual(responsesOfABefore);

    const whichConditionOf = async (sessionId: string) =>
      (await db.responsesFor(sessionId)).find((response) => response.itemId === DEMO_ITEM_IDS.whichCondition);
    const answerA = await whichConditionOf(sessionAId);
    const answerB = await whichConditionOf(sessionBId);
    expect(answerA).toMatchObject({ questionId: whichConditionQuestionId, questionVersion: 1, questionnaireVersion: 1, optionIds: [DEMO_OPTION_IDS.hypertension] });
    expect(answerB).toMatchObject({ questionId: whichConditionQuestionId, questionVersion: 2, questionnaireVersion: 2, optionIds: [DEMO_OPTION_IDS.hypertension] });

    await admin.openVersionHistory(demo.questionnaireId);
    await expect(admin.heading(ADMIN_HEADINGS.versionHistory)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Version 1", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Version 2", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Preview version \d+$/ })).toHaveCount(2);

    await page.getByRole("link", { name: "Preview version 1", exact: true }).click();
    await expect(admin.heading("Preview of version 1")).toBeVisible();
    await page.getByRole("radiogroup", { name: leadingLabel(`1. ${prompts.hasCondition}`) }).getByRole("radio", { name: YES, exact: true }).check();
    const preview = page.getByRole("region", { name: DEMO_V1.title, exact: true });
    const previewedWhichCondition = preview.getByRole("radiogroup", { name: prompts.whichCondition });
    await expect(previewedWhichCondition.getByRole("radio", { name: V1_HYPERTENSION, exact: true })).toBeVisible();
    await expect(previewedWhichCondition.getByRole("radio", { name: V2_HYPERTENSION, exact: true })).toHaveCount(0);
  });
});
