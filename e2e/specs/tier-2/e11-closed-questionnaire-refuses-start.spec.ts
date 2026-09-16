import { createDemoShapedQuestionnaire, expect, RESPONDENT_HEADINGS, test } from "../../fixtures/index.ts";
import { isCreateSessionRequest, problemReplyOf } from "./support/submit-traffic.ts";

test.describe("E11 — a closed questionnaire refuses to start", () => {
  test("landing on a questionnaire past closes_at with empty storage shows the closed screen and creates no session", async ({
    page,
    api,
    respondent,
    db,
    browserErrors,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api);
    await db.closeQuestionnaire(demo.questionnaireId, { minutes: 5 });

    await respondent.clearStoredValue(demo.questionnaireId);
    expect(await respondent.readStoredValue(demo.questionnaireId)).toEqual({ kind: "absent" });

    const startRefused = page.waitForResponse((response) => isCreateSessionRequest(response.request()));
    await respondent.goto(demo.questionnaireId);
    const response = await startRefused;
    expect(response.status()).toBe(409);
    expect((await problemReplyOf(response)).slug).toBe("questionnaire/closed");

    await expect(respondent.heading(RESPONDENT_HEADINGS.closed)).toBeVisible();
    await expect(respondent.submitButton()).toHaveCount(0);
    expect(await respondent.readStoredValue(demo.questionnaireId)).toEqual({ kind: "absent" });
    expect(await db.sessionsFor(demo.questionnaireId)).toEqual([]);
    expect(browserErrors.pageErrors).toEqual([]);
  });
});
