import { createDemoShapedQuestionnaire, DEMO_ITEM_IDS, DEMO_OPTION_IDS, expect, test } from "../../fixtures/index.ts";
import { answerNoPath } from "./support/demo-answers.ts";
import { ERROR_SUMMARY_TITLES, UNPLACED_ERRORS_MESSAGE } from "./support/respondent-messages.ts";
import { problemReplyOf, SUBMIT_URL_GLOB, submitBodyOf, waitForSubmitResponse } from "./support/submit-traffic.ts";

const INJECTED_OTHER_TEXT = "tampered-secret-7f3a91";

test.describe("E8 — the server is the authority over a tampered client", () => {
  test("an answer to an unreachable item is rejected with answer/not-visible, never echoed, and nothing is written", async ({
    page,
    api,
    respondent,
    db,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api);
    await respondent.openForm(demo.questionnaireId);
    const { sessionId } = await respondent.waitForEnvelope(demo.questionnaireId);
    await answerNoPath(respondent, "Corner pharmacy");

    await page.route(SUBMIT_URL_GLOB, async (route) => {
      const { answers } = submitBodyOf(route.request());
      const tampered = {
        answers: {
          ...answers,
          [DEMO_ITEM_IDS.whichCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.other, otherText: INJECTED_OTHER_TEXT },
        },
      };
      await route.continue({ postData: JSON.stringify(tampered) });
    });

    const rejected = waitForSubmitResponse(page);
    await respondent.submit();
    const response = await rejected;

    expect(submitBodyOf(response.request()).answers[DEMO_ITEM_IDS.whichCondition]).toMatchObject({ otherText: INJECTED_OTHER_TEXT });
    expect(response.status()).toBe(422);
    const reply = await problemReplyOf(response);
    expect(reply.slug).toBe("submission/invalid");
    expect(reply.problem.items).toEqual([{ itemId: DEMO_ITEM_IDS.whichCondition, code: "answer/not-visible" }]);
    expect(reply.raw).not.toContain(INJECTED_OTHER_TEXT);

    const summary = respondent.errorSummary();
    await expect(summary.getByRole("heading", { level: 2, name: ERROR_SUMMARY_TITLES.unplaced })).toBeVisible();
    await expect(summary).toContainText(UNPLACED_ERRORS_MESSAGE);
    await expect(page.getByText(INJECTED_OTHER_TEXT)).toHaveCount(0);

    expect(await db.responsesFor(sessionId)).toEqual([]);
    expect(await db.session(sessionId)).toMatchObject({ status: "in_progress", submittedAt: null, responseDigest: null });
  });
});
