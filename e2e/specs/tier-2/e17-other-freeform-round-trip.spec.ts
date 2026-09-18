import { createDemoShapedQuestionnaire, DEMO_ITEM_IDS, DEMO_OPTION_IDS, DEMO_V1, expect, test } from "../../fixtures/index.ts";
import { ITEM_ERROR_MESSAGES } from "./support/respondent-messages.ts";
import { recordSubmitRequests, submitBodyOf, waitForSubmitResponse } from "./support/submit-traffic.ts";

const { hasCondition, whichCondition, diagnosedOn, pharmacy } = DEMO_V1.prompts;
const OTHER_LABEL = DEMO_V1.optionLabel(DEMO_OPTION_IDS.other);

test.describe("E17 — freeform other round trip", () => {
  test("choosing Other requires visible text, and the typed text is stored with the other option", async ({ page, api, respondent, db }) => {
    const demo = await createDemoShapedQuestionnaire(api);
    const submitRequests = recordSubmitRequests(page);
    await respondent.openForm(demo.questionnaireId);
    const { sessionId } = await respondent.waitForEnvelope(demo.questionnaireId);

    const conditionGroup = respondent.choiceGroup(whichCondition);

    await respondent.choose(hasCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes));
    await respondent.choose(whichCondition, OTHER_LABEL);
    await expect(conditionGroup).not.toHaveAttribute("aria-invalid", "true");

    await respondent.fillDate(diagnosedOn, "2020-02-29");
    await expect(conditionGroup).toHaveAttribute("aria-invalid", "true");
    await expect(conditionGroup).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.otherTextRequired(OTHER_LABEL));

    await respondent.fillText(pharmacy, "Corner pharmacy");
    await respondent.submit();
    await expect(conditionGroup).toHaveAttribute("aria-invalid", "true");
    await expect(conditionGroup).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.otherTextRequired(OTHER_LABEL));

    await respondent.fillOtherText(whichCondition, "   ");
    await respondent.submit();
    await expect(conditionGroup).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.otherTextRequired(OTHER_LABEL));
    expect(submitRequests).toHaveLength(0);

    await respondent.fillOtherText(whichCondition, "Asthma");
    await expect(conditionGroup).not.toHaveAttribute("aria-invalid", "true");
    await expect.poll(async () => (await respondent.readEnvelope(demo.questionnaireId)).answers[DEMO_ITEM_IDS.whichCondition]).toEqual({
      type: "single_choice",
      optionId: DEMO_OPTION_IDS.other,
      otherText: "Asthma",
    });

    const accepted = waitForSubmitResponse(page);
    await respondent.submit();
    const response = await accepted;
    expect(response.status()).toBe(200);
    expect(submitBodyOf(response.request()).answers[DEMO_ITEM_IDS.whichCondition]).toEqual({
      type: "single_choice",
      optionId: DEMO_OPTION_IDS.other,
      otherText: "Asthma",
    });
    await respondent.expectReceipt();

    const rows = await db.responsesFor(sessionId);
    expect(rows.find((row) => row.itemId === DEMO_ITEM_IDS.whichCondition)).toMatchObject({
      questionType: "single_choice",
      optionIds: [DEMO_OPTION_IDS.other],
      otherText: "Asthma",
    });
  });

  test("switching from Other to a listed option drops the text from the answer and the submit is accepted", async ({
    page,
    api,
    respondent,
    db,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api);
    await respondent.openForm(demo.questionnaireId);
    const { sessionId } = await respondent.waitForEnvelope(demo.questionnaireId);

    await respondent.choose(hasCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes));
    await respondent.choose(whichCondition, OTHER_LABEL);
    await respondent.fillOtherText(whichCondition, "Asthma");
    await respondent.fillDate(diagnosedOn, "2020-02-29");
    await respondent.fillText(pharmacy, "Corner pharmacy");

    const storedCondition = async () => (await respondent.readEnvelope(demo.questionnaireId)).answers[DEMO_ITEM_IDS.whichCondition];

    await respondent.choose(whichCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.diabetes));
    await expect.poll(storedCondition).toEqual({ type: "single_choice", optionId: DEMO_OPTION_IDS.diabetes });

    await respondent.choose(whichCondition, OTHER_LABEL);
    await expect(respondent.otherText(whichCondition)).toHaveValue("Asthma");
    await expect.poll(storedCondition).toEqual({ type: "single_choice", optionId: DEMO_OPTION_IDS.other, otherText: "Asthma" });

    await respondent.choose(whichCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.diabetes));
    await expect.poll(storedCondition).toEqual({ type: "single_choice", optionId: DEMO_OPTION_IDS.diabetes });

    const accepted = waitForSubmitResponse(page);
    await respondent.submit();
    const response = await accepted;
    expect(submitBodyOf(response.request()).answers[DEMO_ITEM_IDS.whichCondition]).toEqual({
      type: "single_choice",
      optionId: DEMO_OPTION_IDS.diabetes,
    });
    expect(response.status()).toBe(200);
    await respondent.expectReceipt();

    const rows = await db.responsesFor(sessionId);
    expect(rows.find((row) => row.itemId === DEMO_ITEM_IDS.whichCondition)).toMatchObject({
      optionIds: [DEMO_OPTION_IDS.diabetes],
      otherText: null,
    });
  });
});
