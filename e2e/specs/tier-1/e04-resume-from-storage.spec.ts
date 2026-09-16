import type { Page } from "@playwright/test";
import { executionApi } from "@qp/shared";
import { Value } from "typebox/value";
import { createDemoShapedQuestionnaire, DEMO_ITEM_IDS, DEMO_OPTION_IDS, DEMO_V1, expect, test, type RespondentPage } from "../../fixtures/index.ts";
import { ApiTraffic, openRespondentBrowser } from "./support/respondent-browser.ts";

const prompts = DEMO_V1.prompts;
const YES = DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes);
const DIABETES = DEMO_V1.optionLabel(DEMO_OPTION_IDS.diabetes);
const RESTORED_NOTICE = "We restored the answers you started on this device.";

const STARTED_ANSWERS = {
  [DEMO_ITEM_IDS.hasCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.yes },
  [DEMO_ITEM_IDS.whichCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.diabetes },
} as const;

const ResumedSessionReply = executionApi.getSession.schema.response[200];

async function resumedDefinitionVersion(page: Page, sessionId: string, navigate: () => Promise<unknown>): Promise<number> {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().method() === "GET" && new URL(candidate.url()).pathname.endsWith(`/sessions/${sessionId}`)),
    navigate(),
  ]);
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  if (!Value.Check(ResumedSessionReply, body)) throw new Error(`GET /sessions/${sessionId} answered outside its contract`);
  expect(body.session.sessionId).toBe(sessionId);
  return body.definition.version;
}

async function expectStartedAnswersRestored(respondent: RespondentPage): Promise<void> {
  await respondent.expectForm();
  await expect(respondent.page.getByText(RESTORED_NOTICE, { exact: true })).toBeVisible();
  await expect(respondent.option(prompts.hasCondition, YES)).toBeChecked();
  await expect(respondent.option(prompts.whichCondition, DIABETES)).toBeChecked();
  await expect(respondent.question(prompts.diagnosedOn)).toHaveValue("");
}

test.describe("E4 — resume from storage", () => {
  test("a reload and a new browser context with the same storage resume one session from GET /sessions/:id and submit one response set", async ({
    browser,
    stack,
    api,
    db,
  }) => {
    const { questionnaireId } = await createDemoShapedQuestionnaire(api, { name: "E4 resume" });
    const traffic = new ApiTraffic();

    const first = await openRespondentBrowser(browser, stack.baseUrl);
    traffic.watch(first.context);
    await first.respondent.openForm(questionnaireId);
    await first.respondent.choose(prompts.hasCondition, YES);
    await first.respondent.choose(prompts.whichCondition, DIABETES);
    await expect.poll(async () => (await first.respondent.readEnvelope(questionnaireId)).answers).toEqual(STARTED_ANSWERS);
    const { sessionId } = await first.respondent.readEnvelope(questionnaireId);
    expect(traffic.sessionCreations()).toHaveLength(1);
    expect(await db.session(sessionId)).toMatchObject({ questionnaireId, status: "in_progress" });

    traffic.clear();
    expect(await resumedDefinitionVersion(first.page, sessionId, () => first.page.reload())).toBe(1);
    await expectStartedAnswersRestored(first.respondent);
    expect(traffic.sessionCreations()).toEqual([]);
    expect(traffic.sessionReads(sessionId)).toHaveLength(1);
    expect(traffic.definitionRequests()).toEqual([]);
    expect((await first.respondent.readEnvelope(questionnaireId)).sessionId).toBe(sessionId);

    const storageState = await first.context.storageState();
    await first.context.close();

    const second = await openRespondentBrowser(browser, stack.baseUrl, storageState);
    traffic.clear();
    traffic.watch(second.context);
    expect(await resumedDefinitionVersion(second.page, sessionId, () => second.respondent.goto(questionnaireId))).toBe(1);
    await expectStartedAnswersRestored(second.respondent);
    expect(traffic.sessionCreations()).toEqual([]);
    expect(traffic.sessionReads(sessionId)).toHaveLength(1);
    expect(traffic.definitionRequests()).toEqual([]);
    expect((await second.respondent.readEnvelope(questionnaireId)).sessionId).toBe(sessionId);

    await second.respondent.fillDate(prompts.diagnosedOn, "2021-11-30");
    await second.respondent.fillText(prompts.pharmacy, "Riverside pharmacy");
    const receipt = await second.respondent.submitAndExpectReceipt();
    expect(receipt.sessionId).toBe(sessionId);
    expect(traffic.sessionCreations()).toEqual([]);
    expect(traffic.submissions(sessionId)).toHaveLength(1);
    await second.context.close();

    expect((await db.sessionsFor(questionnaireId)).map((session) => session.sessionId)).toEqual([sessionId]);
    expect(await db.session(sessionId)).toMatchObject({ questionnaireId, version: 1, status: "submitted" });
    const responses = await db.responsesFor(sessionId);
    expect(responses).toEqual([
      expect.objectContaining({ itemId: DEMO_ITEM_IDS.hasCondition, optionIds: [DEMO_OPTION_IDS.yes] }),
      expect.objectContaining({ itemId: DEMO_ITEM_IDS.whichCondition, optionIds: [DEMO_OPTION_IDS.diabetes] }),
      expect.objectContaining({ itemId: DEMO_ITEM_IDS.diagnosedOn, dateValue: "2021-11-30" }),
      expect.objectContaining({ itemId: DEMO_ITEM_IDS.pharmacy, textValue: "Riverside pharmacy" }),
    ]);
  });
});
