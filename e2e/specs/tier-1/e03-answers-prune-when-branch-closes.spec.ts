import { executionApi } from "@qp/shared";
import { DEMO_ITEM_IDS, DEMO_OPTION_IDS, DEMO_QUESTIONNAIRE_ID, DEMO_V1, expect, test } from "../../fixtures/index.ts";

const prompts = DEMO_V1.prompts;
const YES = DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes);
const NO = DEMO_V1.optionLabel(DEMO_OPTION_IDS.no);
const OTHER = DEMO_V1.optionLabel(DEMO_OPTION_IDS.other);

const OTHER_CONDITION = { type: "single_choice", optionId: DEMO_OPTION_IDS.other, otherText: "Coeliac disease" } as const;
const DIAGNOSED_ON = { type: "date", date: "2018-03-09" } as const;

test.describe("E3 — answers prune when a branch closes", () => {
  test("closing the branch hides its answers but keeps them in storage, restores them on reopening, and filters them once at submit", async ({
    page,
    db,
    respondent,
    browserErrors,
  }) => {
    await respondent.openForm(DEMO_QUESTIONNAIRE_ID);
    const form = respondent.form(DEMO_V1.title);

    await respondent.choose(prompts.hasCondition, YES);
    await respondent.choose(prompts.whichCondition, OTHER);
    await respondent.fillOtherText(prompts.whichCondition, OTHER_CONDITION.otherText);
    await respondent.fillDate(prompts.diagnosedOn, DIAGNOSED_ON.date);
    await respondent.fillText(prompts.pharmacy, "High Street pharmacy");

    await respondent.choose(prompts.hasCondition, NO);

    await expect(respondent.choiceGroup(prompts.whichCondition)).toHaveCount(0);
    await expect(respondent.question(prompts.diagnosedOn)).toHaveCount(0);
    await expect(form.locator(`[data-item-id="${DEMO_ITEM_IDS.whichCondition}"]`)).toHaveCount(0);
    await expect(form.locator(`[data-item-id="${DEMO_ITEM_IDS.diagnosedOn}"]`)).toHaveCount(0);

    const afterClosing = await respondent.readEnvelope(DEMO_QUESTIONNAIRE_ID);
    expect(afterClosing.answers).toEqual({
      [DEMO_ITEM_IDS.hasCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.no },
      [DEMO_ITEM_IDS.whichCondition]: OTHER_CONDITION,
      [DEMO_ITEM_IDS.diagnosedOn]: DIAGNOSED_ON,
      [DEMO_ITEM_IDS.pharmacy]: { type: "text", text: "High Street pharmacy" },
    });

    await respondent.choose(prompts.hasCondition, YES);
    await expect(respondent.option(prompts.whichCondition, OTHER)).toBeChecked();
    await expect(respondent.otherText(prompts.whichCondition)).toHaveValue(OTHER_CONDITION.otherText);
    await expect(respondent.question(prompts.diagnosedOn)).toHaveValue(DIAGNOSED_ON.date);

    await respondent.choose(prompts.hasCondition, NO);
    await expect(respondent.choiceGroup(prompts.whichCondition)).toHaveCount(0);
    expect((await respondent.readEnvelope(DEMO_QUESTIONNAIRE_ID)).answers).toMatchObject({
      [DEMO_ITEM_IDS.whichCondition]: OTHER_CONDITION,
      [DEMO_ITEM_IDS.diagnosedOn]: DIAGNOSED_ON,
    });

    const submitRequest = page.waitForRequest(
      (request) => request.method() === executionApi.submitSession.method && new URL(request.url()).pathname.endsWith("/submit"),
    );
    const receipt = await respondent.submitAndExpectReceipt();
    expect((await submitRequest).postDataJSON()).toEqual({
      answers: {
        [DEMO_ITEM_IDS.hasCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.no },
        [DEMO_ITEM_IDS.pharmacy]: { type: "text", text: "High Street pharmacy" },
      },
    });

    expect(receipt.sessionId).toBe(afterClosing.sessionId);
    expect(await db.session(receipt.sessionId)).toMatchObject({ questionnaireId: DEMO_QUESTIONNAIRE_ID, status: "submitted" });
    const responses = await db.responsesFor(receipt.sessionId);
    expect(responses.map((response) => response.itemId)).toEqual([DEMO_ITEM_IDS.hasCondition, DEMO_ITEM_IDS.pharmacy]);
    expect(responses[0]).toMatchObject({ optionIds: [DEMO_OPTION_IDS.no] });
    expect(responses[1]).toMatchObject({ textValue: "High Street pharmacy" });
    expect(browserErrors.summary()).toEqual({ consoleErrors: [], pageErrors: [] });
  });
});
