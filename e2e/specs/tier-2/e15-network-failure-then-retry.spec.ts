import { createDemoShapedQuestionnaire, DEMO_ITEM_IDS, DEMO_OPTION_IDS, expect, RESPONDENT_BUTTONS, RESPONDENT_HEADINGS, test } from "../../fixtures/index";
import { answerNoPath } from "./support/demo-answers";
import { createGate } from "./support/gate";
import { RETRY_PENDING_LABEL, SUBMIT_FAILED_MESSAGE } from "./support/respondent-messages";
import { recordSubmitRequests, SUBMIT_URL_GLOB, waitForSubmitResponse } from "./support/submit-traffic";

test.describe("E15 — network failure on submit, then manual retry", () => {
  test("an aborted submit keeps the stored answers and offers a retry that is disabled in flight and writes one response set", async ({
    page,
    api,
    respondent,
    db,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api);
    await respondent.openForm(demo.questionnaireId);
    const { sessionId } = await respondent.waitForEnvelope(demo.questionnaireId);
    await answerNoPath(respondent, "Corner pharmacy");
    const answered = {
      [DEMO_ITEM_IDS.hasCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.no },
      [DEMO_ITEM_IDS.pharmacy]: { type: "text", text: "Corner pharmacy" },
    };
    await expect.poll(async () => (await respondent.readEnvelope(demo.questionnaireId)).answers).toEqual(answered);

    const retryReleased = createGate();
    let submitAttempts = 0;
    await page.route(SUBMIT_URL_GLOB, async (route) => {
      submitAttempts += 1;
      if (submitAttempts === 1) {
        await route.abort("internetdisconnected");
        return;
      }
      await retryReleased.opened;
      await route.continue();
    });
    const submitRequests = recordSubmitRequests(page);

    await respondent.submit();

    await expect(page.getByRole("alert").filter({ hasText: SUBMIT_FAILED_MESSAGE })).toBeVisible();
    await expect(respondent.tryAgainButton()).toBeVisible();
    await expect(respondent.tryAgainButton()).toBeFocused();
    await expect(respondent.submitButton()).toBeEnabled();
    expect(submitRequests).toHaveLength(1);

    const afterFailure = await respondent.readEnvelope(demo.questionnaireId);
    expect(afterFailure).toMatchObject({ sessionId, answers: answered });
    expect(await db.responsesFor(sessionId)).toEqual([]);

    const accepted = waitForSubmitResponse(page);
    await respondent.tryAgainButton().click();

    const pendingRetry = page.getByRole("button", { name: RETRY_PENDING_LABEL, exact: true });
    const pendingSubmit = page.getByRole("button", { name: RESPONDENT_BUTTONS.submitting, exact: true });
    await expect(pendingSubmit).toBeDisabled();
    await expect(pendingRetry).toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => submitAttempts).toBe(2);

    await pendingRetry.click({ force: true });
    await pendingSubmit.click({ force: true });
    expect((await respondent.readEnvelope(demo.questionnaireId)).answers).toEqual(answered);

    retryReleased.open();
    expect((await accepted).status()).toBe(200);
    const receipt = await respondent.expectReceipt(RESPONDENT_HEADINGS.submitted);
    expect(receipt.sessionId).toBe(sessionId);
    expect(submitRequests).toHaveLength(2);
    expect(submitAttempts).toBe(2);

    expect(await db.responsesFor(sessionId)).toMatchObject([
      { itemId: DEMO_ITEM_IDS.hasCondition, optionIds: [DEMO_OPTION_IDS.no] },
      { itemId: DEMO_ITEM_IDS.pharmacy, textValue: "Corner pharmacy" },
    ]);
    expect(await db.session(sessionId)).toMatchObject({ status: "submitted" });
    expect((await respondent.readEnvelope(demo.questionnaireId)).answers).toEqual({});
  });
});
