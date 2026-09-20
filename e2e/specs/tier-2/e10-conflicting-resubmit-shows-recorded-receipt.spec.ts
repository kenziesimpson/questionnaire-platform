import {
  createDemoShapedQuestionnaire,
  DEMO_ITEM_IDS,
  DEMO_OPTION_IDS,
  DEMO_V1,
  expect,
  recordRequests,
  RESPONDENT_HEADINGS,
  RespondentPage,
  test,
} from "../../fixtures/index";
import { answerNoPath } from "./support/demo-answers";
import { ALREADY_SUBMITTED_NOTE } from "./support/respondent-messages";
import { isGetSessionRequest, problemReplyOf, waitForSubmitResponse } from "./support/submit-traffic";

test.describe("E10 — a conflicting resubmit is not a dead end", () => {
  test("a resubmit with a changed answer gets 409, and the app shows the recorded receipt with a note", async ({
    context,
    page,
    api,
    respondent,
    db,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api);
    await respondent.openForm(demo.questionnaireId);
    const { sessionId } = await respondent.waitForEnvelope(demo.questionnaireId);
    await answerNoPath(respondent, "Corner pharmacy");

    const otherTab = new RespondentPage(await context.newPage());
    await otherTab.openForm(demo.questionnaireId);
    await expect(otherTab.page.getByRole("textbox", { name: DEMO_V1.prompts.pharmacy })).toHaveValue("Corner pharmacy");
    const recorded = await otherTab.submitAndExpectReceipt();
    expect(recorded.sessionId).toBe(sessionId);
    expect((await respondent.readEnvelope(demo.questionnaireId)).answers).toEqual({});

    await respondent.fillText(DEMO_V1.prompts.pharmacy, "Harbour pharmacy");
    await expect.poll(async () => (await respondent.readEnvelope(demo.questionnaireId)).answers[DEMO_ITEM_IDS.pharmacy]).toEqual({
      type: "text",
      text: "Harbour pharmacy",
    });

    const sessionReads = recordRequests(page, (request) => isGetSessionRequest(request, sessionId));
    const conflicted = waitForSubmitResponse(page);
    await respondent.submit();
    const response = await conflicted;
    expect(response.status()).toBe(409);
    expect((await problemReplyOf(response)).slug).toBe("session/already-submitted");

    const shown = await respondent.expectReceipt(RESPONDENT_HEADINGS.alreadySubmitted);
    await expect(page.getByText(ALREADY_SUBMITTED_NOTE)).toBeVisible();
    expect(shown).toEqual(recorded);
    expect(sessionReads).toHaveLength(1);
    await expect(respondent.heading(RESPONDENT_HEADINGS.somethingWentWrong)).toHaveCount(0);
    await expect(respondent.tryAgainButton()).toHaveCount(0);

    expect(await db.responsesFor(sessionId)).toMatchObject([
      { itemId: DEMO_ITEM_IDS.hasCondition, optionIds: [DEMO_OPTION_IDS.no] },
      { itemId: DEMO_ITEM_IDS.pharmacy, textValue: "Corner pharmacy" },
    ]);
    expect((await db.session(sessionId))?.submittedAt?.toISOString()).toBe(recorded.submittedAt);
    expect((await respondent.readEnvelope(demo.questionnaireId)).answers).toEqual({});
  });
});
