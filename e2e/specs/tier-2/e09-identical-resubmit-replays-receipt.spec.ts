import { Value } from "typebox/value";
import { createDemoShapedQuestionnaire, DEMO_ITEM_IDS, DEMO_OPTION_IDS, expect, RESPONDENT_HEADINGS, test } from "../../fixtures/index.ts";
import { answerNoPath } from "./support/demo-answers.ts";
import { receiptBodyOf, recordSubmitRequests, submitBodyOf, SubmitReceiptBody, waitForSubmitResponse } from "./support/submit-traffic.ts";

test.describe("E9 — replaying an identical submit returns the same receipt", () => {
  test("a double-click sends one submit, and re-firing the same answers after a reload replays the original receipt", async ({
    page,
    api,
    respondent,
    execution,
    db,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api);
    const submitRequests = recordSubmitRequests(page);
    await respondent.openForm(demo.questionnaireId);
    const { sessionId } = await respondent.waitForEnvelope(demo.questionnaireId);
    await answerNoPath(respondent, "Corner pharmacy");

    const accepted = waitForSubmitResponse(page);
    await respondent.submitButton().dblclick();
    const firstResponse = await accepted;
    expect(firstResponse.status()).toBe(200);
    const { receipt } = await receiptBodyOf(firstResponse);
    const shownReceipt = await respondent.expectReceipt();
    expect(shownReceipt).toMatchObject({ sessionId, submittedAt: receipt.submittedAt });
    expect(submitRequests).toHaveLength(1);

    const [firstRequest] = submitRequests;
    if (firstRequest === undefined) throw new Error("The submit request was not recorded");
    const sentAnswers = submitBodyOf(firstRequest).answers;
    expect(sentAnswers).toEqual({
      [DEMO_ITEM_IDS.hasCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.no },
      [DEMO_ITEM_IDS.pharmacy]: { type: "text", text: "Corner pharmacy" },
    });

    const rowsAfterFirstSubmit = await db.responsesFor(sessionId);
    expect(rowsAfterFirstSubmit).toMatchObject([
      { itemId: DEMO_ITEM_IDS.hasCondition, optionIds: [DEMO_OPTION_IDS.no] },
      { itemId: DEMO_ITEM_IDS.pharmacy, textValue: "Corner pharmacy" },
    ]);

    await page.reload();
    expect(await respondent.expectReceipt(RESPONDENT_HEADINGS.submitted)).toEqual(shownReceipt);
    expect(submitRequests).toHaveLength(1);

    const replay = await execution.sendSubmit(sessionId, sentAnswers);
    expect(replay.status).toBe(200);
    expect(Value.Check(SubmitReceiptBody, replay.body)).toBe(true);
    expect(replay.body).toEqual({ receipt });

    expect(await db.responsesFor(sessionId)).toEqual(rowsAfterFirstSubmit);
    const session = await db.session(sessionId);
    expect(session).toMatchObject({ status: "submitted" });
    expect(session?.submittedAt?.toISOString()).toBe(receipt.submittedAt);
  });
});
