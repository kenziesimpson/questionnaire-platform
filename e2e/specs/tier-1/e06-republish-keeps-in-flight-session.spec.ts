import { executionApi } from "@qp/shared";
import {
  createDemoShapedQuestionnaire,
  DEMO_ITEM_IDS,
  DEMO_OPTION_IDS,
  DEMO_V1,
  DEMO_V2,
  expect,
  matchesExecutionRoute,
  publishDemoHypertensionRelabel,
  recordRequests,
  test,
} from "../../fixtures/index";
import { MainFrameNavigations } from "./support/respondent-browser";

const prompts = DEMO_V1.prompts;
const YES = DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes);
const V1_HYPERTENSION = DEMO_V1.optionLabel(DEMO_OPTION_IDS.hypertension);
const V2_HYPERTENSION = DEMO_V2.optionLabel(DEMO_OPTION_IDS.hypertension);

test.describe("E6 — a republish does not disturb an in-flight session", () => {
  test("a session open while v2 is published keeps its v1 labels and submits against the pinned v1", async ({
    page,
    context,
    api,
    db,
    respondent,
    browserErrors,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api, { name: "E6 in-flight" });
    const traffic = recordRequests(context);

    await respondent.openForm(demo.questionnaireId);
    await expect(page.getByText(`${DEMO_V1.title} · version 1`, { exact: true })).toBeVisible();
    await respondent.choose(prompts.hasCondition, YES);
    await expect(respondent.option(prompts.whichCondition, V1_HYPERTENSION)).toBeVisible();
    const { sessionId } = await respondent.readEnvelope(demo.questionnaireId);
    const navigations = new MainFrameNavigations();
    navigations.watch(page);

    const republished = await publishDemoHypertensionRelabel(api, demo);
    expect(republished.version.version).toBe(2);
    expect((await api.questionnaireSummary(demo.questionnaireId)).currentVersion).toBe(2);

    await expect(respondent.option(prompts.whichCondition, V1_HYPERTENSION)).toBeVisible();
    await expect(respondent.option(prompts.whichCondition, V2_HYPERTENSION)).toHaveCount(0);
    await expect(page.getByText(`${DEMO_V1.title} · version 1`, { exact: true })).toBeVisible();

    await respondent.choose(prompts.whichCondition, V1_HYPERTENSION);
    await respondent.fillDate(prompts.diagnosedOn, "2012-07-01");
    await respondent.fillText(prompts.pharmacy, "In-flight pharmacy");
    const receipt = await respondent.submitAndExpectReceipt();

    expect(receipt.sessionId).toBe(sessionId);
    expect(navigations.urls).toEqual([]);
    expect(traffic.filter((request) => matchesExecutionRoute(request, executionApi.createSession))).toHaveLength(1);
    expect(traffic.filter((request) => matchesExecutionRoute(request, executionApi.submitSession, { sessionId }))).toHaveLength(1);

    const [v1] = await db.versionsOf(demo.questionnaireId);
    expect(await db.session(sessionId)).toMatchObject({
      questionnaireId: demo.questionnaireId,
      questionnaireVersionId: v1?.questionnaireVersionId,
      version: 1,
      status: "submitted",
    });
    const responses = await db.responsesFor(sessionId);
    expect(responses).toHaveLength(4);
    for (const response of responses) {
      expect(response).toMatchObject({ questionnaireVersion: 1, questionnaireVersionId: v1?.questionnaireVersionId, questionVersion: 1 });
    }
    expect(responses.find((response) => response.itemId === DEMO_ITEM_IDS.whichCondition)).toMatchObject({
      questionId: demo.questions.whichCondition.questionId,
      optionIds: [DEMO_OPTION_IDS.hypertension],
    });
    expect(browserErrors.summary()).toEqual({ consoleErrors: [], pageErrors: [] });
  });
});
