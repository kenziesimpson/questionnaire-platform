import { createDemoShapedQuestionnaire, DEMO_ITEM_IDS, DEMO_OPTION_IDS, expect, RESPONDENT_HEADINGS, test } from "../../fixtures/index";
import { answerNoPath } from "./support/demo-answers";
import { problemReplyOf, waitForSubmitResponse } from "./support/submit-traffic";

test.describe("E12 — a questionnaire that closes mid-session refuses the submit", () => {
  test("a submit after closes_at passes gets 409 questionnaire/closed, writes nothing and keeps the stored answers", async ({
    page,
    api,
    respondent,
    db,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api);
    await respondent.openForm(demo.questionnaireId);
    const { sessionId } = await respondent.waitForEnvelope(demo.questionnaireId);
    await answerNoPath(respondent, "Corner pharmacy");

    const answersBeforeClosing = {
      [DEMO_ITEM_IDS.hasCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.no },
      [DEMO_ITEM_IDS.pharmacy]: { type: "text", text: "Corner pharmacy" },
    };
    await expect.poll(async () => (await respondent.readEnvelope(demo.questionnaireId)).answers).toEqual(answersBeforeClosing);

    await db.closeQuestionnaire(demo.questionnaireId, { minutes: 1 });

    const refused = waitForSubmitResponse(page);
    await respondent.submit();
    const response = await refused;
    expect(response.status()).toBe(409);
    expect((await problemReplyOf(response)).slug).toBe("questionnaire/closed");

    await expect(respondent.heading(RESPONDENT_HEADINGS.closed)).toBeVisible();
    expect(await db.responsesFor(sessionId)).toEqual([]);
    expect(await db.session(sessionId)).toMatchObject({ status: "in_progress", submittedAt: null, responseDigest: null });

    const stored = await respondent.readEnvelope(demo.questionnaireId);
    expect(stored.sessionId).toBe(sessionId);
    expect(stored.answers).toEqual(answersBeforeClosing);
  });
});
