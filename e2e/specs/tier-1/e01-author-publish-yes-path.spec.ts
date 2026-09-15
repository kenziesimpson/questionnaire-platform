import {
  DEMO_V1,
  DEMO_OPTION_IDS,
  expect,
  RESPONDENT_HEADINGS,
  test,
  uniqueName,
} from "../../fixtures/index.ts";
import { DraftAuthoring } from "./support/draft-authoring.ts";
import { MainFrameNavigations, openRespondentBrowser } from "./support/respondent-browser.ts";

const prompts = DEMO_V1.prompts;
const HYPERTENSION = DEMO_V1.optionLabel(DEMO_OPTION_IDS.hypertension);
const YES = DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes);

test.describe("E1 — author, publish, and take the yes path", () => {
  test("a questionnaire authored in the admin UI reveals its branch in place and persists four pinned responses", async ({
    page,
    browser,
    stack,
    api,
    db,
    browserErrors,
  }) => {
    const authoring = new DraftAuthoring(page);
    const questionnaireId = await authoring.createQuestionnaire(uniqueName("E1 intake"), DEMO_V1.title);

    await authoring.addNewQuestion({ kind: "yesNo", prompt: prompts.hasCondition });
    await authoring.addNewQuestion({
      kind: "singleChoice",
      prompt: prompts.whichCondition,
      optionLabels: [DEMO_V1.optionLabel(DEMO_OPTION_IDS.diabetes), HYPERTENSION],
      allowOther: true,
    });
    await authoring.addNewQuestion({ kind: "date", prompt: prompts.diagnosedOn, relativeToToday: "Not in the future" });
    await authoring.addNewQuestion({ kind: "text", prompt: prompts.pharmacy, maxLength: 120 });
    await expect(authoring.admin.draftItemsRegion()).toHaveAccessibleName("4 questions");

    const yesCondition = { position: 1, prompt: prompts.hasCondition, optionLabel: YES };
    await authoring.showOnlyWhen(2, yesCondition);
    await authoring.showOnlyWhen(3, yesCondition);
    await authoring.publish(1);

    const definition = await api.getVersion(questionnaireId, 1);
    expect(definition.items.map((item) => [item.question.prompt, item.visibleWhen])).toEqual([
      [prompts.hasCondition, null],
      [prompts.whichCondition, { all: [{ type: "single_choice", itemId: definition.items[0]?.itemId, op: "is", optionId: DEMO_OPTION_IDS.yes }] }],
      [prompts.diagnosedOn, { all: [{ type: "single_choice", itemId: definition.items[0]?.itemId, op: "is", optionId: DEMO_OPTION_IDS.yes }] }],
      [prompts.pharmacy, null],
    ]);
    const [hasCondition, whichCondition, diagnosedOn, pharmacy] = definition.items;
    if (hasCondition === undefined || whichCondition === undefined || diagnosedOn === undefined || pharmacy === undefined) {
      throw new Error("The published definition does not hold the four authored items");
    }

    const { context, page: respondentPage, respondent } = await openRespondentBrowser(browser, stack.baseUrl);
    browserErrors.watch(respondentPage);
    await respondent.openForm(questionnaireId);
    const form = respondent.form(DEMO_V1.title);
    const renderedItemIds = form.locator("[data-item-id]");

    await expect(respondent.choiceGroup(prompts.hasCondition)).toBeVisible();
    await expect(respondent.question(prompts.pharmacy)).toBeVisible();
    await expect(respondent.choiceGroup(prompts.whichCondition)).toHaveCount(0);
    await expect(respondent.question(prompts.diagnosedOn)).toHaveCount(0);
    await expect(form.locator(`[data-item-id="${whichCondition.itemId}"]`)).toHaveCount(0);
    await expect(form.locator(`[data-item-id="${diagnosedOn.itemId}"]`)).toHaveCount(0);

    const formUrl = respondentPage.url();
    const navigations = new MainFrameNavigations();
    navigations.watch(respondentPage);

    await respondent.choose(prompts.hasCondition, YES);

    await expect(respondent.choiceGroup(prompts.whichCondition)).toBeVisible();
    await expect(respondent.question(prompts.diagnosedOn)).toBeVisible();
    await expect(respondent.visibilityAnnouncement()).toHaveText(`2 questions added: ${prompts.whichCondition}; ${prompts.diagnosedOn}.`);
    await expect
      .poll(() => renderedItemIds.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-item-id"))))
      .toEqual(definition.items.map((item) => item.itemId));
    expect(respondentPage.url()).toBe(formUrl);
    expect(navigations.urls).toEqual([]);

    await respondent.choose(prompts.whichCondition, HYPERTENSION);
    await respondent.fillDate(prompts.diagnosedOn, "2019-06-14");
    await respondent.fillText(prompts.pharmacy, "Corner pharmacy");
    const envelope = await respondent.readEnvelope(questionnaireId);

    const receipt = await respondent.submitAndExpectReceipt();
    await expect(respondent.heading(RESPONDENT_HEADINGS.submitted)).toBeVisible();
    expect(receipt.sessionId).toBe(envelope.sessionId);

    const session = await db.session(receipt.sessionId);
    expect(session).toMatchObject({ questionnaireId, version: 1, status: "submitted" });
    const responses = await db.responsesFor(receipt.sessionId);
    const hypertensionOptionId =
      whichCondition.question.type === "single_choice"
        ? whichCondition.question.options.find((option) => option.label === HYPERTENSION)?.optionId
        : undefined;
    expect(hypertensionOptionId).toMatch(/^opt_[a-z0-9]{8}$/);
    const pinned = (item: typeof hasCondition) => ({
      itemId: item.itemId,
      questionnaireVersionId: session?.questionnaireVersionId,
      questionnaireVersion: 1,
      questionId: item.question.questionId,
      questionVersion: item.question.questionVersion,
      questionType: item.question.type,
    });
    expect(responses).toHaveLength(4);
    const responseByItemId = new Map(responses.map((response) => [response.itemId, response]));
    expect(definition.items.map((item) => responseByItemId.get(item.itemId))).toEqual([
      expect.objectContaining({ ...pinned(hasCondition), optionIds: [DEMO_OPTION_IDS.yes], otherText: null }),
      expect.objectContaining({ ...pinned(whichCondition), optionIds: [hypertensionOptionId], otherText: null }),
      expect.objectContaining({ ...pinned(diagnosedOn), dateValue: "2019-06-14" }),
      expect.objectContaining({ ...pinned(pharmacy), textValue: "Corner pharmacy" }),
    ]);

    await context.close();
    expect(browserErrors.summary()).toEqual({ consoleErrors: [], pageErrors: [] });
  });
});
