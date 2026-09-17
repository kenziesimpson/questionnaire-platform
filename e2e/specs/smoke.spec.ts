import {
  ADMIN_HEADINGS,
  ADMIN_PATHS,
  createDemoShapedQuestionnaire,
  DEMO_ITEM_IDS,
  DEMO_OPTION_IDS,
  DEMO_QUESTIONNAIRE_ID,
  DEMO_V1,
  expect,
  RESPONDENT_HEADINGS,
  test,
} from "../fixtures/index.ts";

test.describe("harness smoke", () => {
  test("the seeded demo loads at /q/:id and its session row is readable from the database", async ({
    respondent,
    db,
    browserErrors,
  }) => {
    await respondent.openForm(DEMO_QUESTIONNAIRE_ID);

    await expect(respondent.form(DEMO_V1.title)).toBeVisible();
    await expect(respondent.choiceGroup(DEMO_V1.prompts.hasCondition)).toBeVisible();
    await expect(respondent.question(DEMO_V1.prompts.pharmacy)).toBeVisible();
    await expect(respondent.question(DEMO_V1.prompts.whichCondition)).toHaveCount(0);
    await expect(respondent.question(DEMO_V1.prompts.diagnosedOn)).toHaveCount(0);

    const envelope = await respondent.waitForEnvelope(DEMO_QUESTIONNAIRE_ID);
    expect(envelope.questionnaireId).toBe(DEMO_QUESTIONNAIRE_ID);

    const session = await db.session(envelope.sessionId);
    expect(session).toMatchObject({ questionnaireId: DEMO_QUESTIONNAIRE_ID, version: 1, status: "in_progress", submittedAt: null });

    expect(browserErrors.summary()).toEqual({ consoleErrors: [], pageErrors: [] });
  });

  test("the admin app loads at /admin/", async ({ page, admin, browserErrors }) => {
    await page.goto(ADMIN_PATHS.root);

    await expect(admin.heading(ADMIN_HEADINGS.questionnaires)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${ADMIN_PATHS.questionnaires}$`));
    await expect(admin.questionnaireRow(DEMO_V1.title)).toBeVisible();
    expect(browserErrors.summary()).toEqual({ consoleErrors: [], pageErrors: [] });
  });

  test("a questionnaire published through the definition API renders for respondents and persists a submission", async ({
    api,
    respondent,
    db,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api);
    expect(demo.version.version).toBe(1);
    expect(demo.definition.items.map((item) => item.itemId)).toEqual(Object.values(DEMO_ITEM_IDS));

    await respondent.openForm(demo.questionnaireId);
    await respondent.choose(DEMO_V1.prompts.hasCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes));
    await expect(respondent.choiceGroup(DEMO_V1.prompts.whichCondition)).toBeVisible();
    await respondent.choose(DEMO_V1.prompts.whichCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.other));
    await respondent.fillOtherText(DEMO_V1.prompts.whichCondition, "Asthma");
    await respondent.fillDate(DEMO_V1.prompts.diagnosedOn, "2020-02-29");
    await respondent.fillText(DEMO_V1.prompts.pharmacy, "Corner pharmacy");

    const stored = await respondent.readEnvelope(demo.questionnaireId);
    expect(stored.answers[DEMO_ITEM_IDS.pharmacy]).toEqual({ type: "text", text: "Corner pharmacy" });

    const receipt = await respondent.submitAndExpectReceipt();
    expect(receipt.sessionId).toBe(stored.sessionId);
    await expect(respondent.heading(RESPONDENT_HEADINGS.submitted)).toBeVisible();

    const session = await db.session(receipt.sessionId);
    expect(session).toMatchObject({ questionnaireId: demo.questionnaireId, version: 1, status: "submitted" });

    const responses = await db.responsesFor(receipt.sessionId);
    expect(responses).toMatchObject([
      { itemId: DEMO_ITEM_IDS.hasCondition, questionnaireVersion: 1, questionVersion: 1, optionIds: [DEMO_OPTION_IDS.yes], otherText: null },
      { itemId: DEMO_ITEM_IDS.whichCondition, questionnaireVersion: 1, questionVersion: 1, optionIds: [DEMO_OPTION_IDS.other], otherText: "Asthma" },
      { itemId: DEMO_ITEM_IDS.diagnosedOn, questionnaireVersion: 1, questionVersion: 1, dateValue: "2020-02-29" },
      { itemId: DEMO_ITEM_IDS.pharmacy, questionnaireVersion: 1, questionVersion: 1, textValue: "Corner pharmacy" },
    ]);
  });
});
