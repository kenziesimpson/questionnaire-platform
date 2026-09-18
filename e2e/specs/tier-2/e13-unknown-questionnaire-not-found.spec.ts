import { randomUUID } from "node:crypto";
import { expect, recordRequests, RESPONDENT_HEADINGS, test } from "../../fixtures/index.ts";
import { isCreateSessionRequest, problemReplyOf } from "./support/submit-traffic.ts";

test.describe("E13 — an unknown questionnaire id", () => {
  test("a well-formed id with no questionnaire renders the not-found screen without an unhandled error", async ({
    page,
    respondent,
    db,
    browserErrors,
  }) => {
    const unknownId = randomUUID();
    const startRefused = page.waitForResponse((response) => isCreateSessionRequest(response.request()));
    await respondent.goto(unknownId);
    const response = await startRefused;
    expect(response.status()).toBe(404);
    expect((await problemReplyOf(response)).slug).toBe("resource/not-found");

    await expect(respondent.heading(RESPONDENT_HEADINGS.notFound)).toBeVisible();
    await expect(respondent.submitButton()).toHaveCount(0);
    expect(await respondent.readStoredValue(unknownId)).toEqual({ kind: "absent" });
    expect(await db.sessionsFor(unknownId)).toEqual([]);
    expect(browserErrors.pageErrors).toEqual([]);
    expect(browserErrors.consoleErrorsExceptFailedResourceLoads()).toEqual([]);
  });

  test("a malformed id renders the same not-found screen without calling the API", async ({ page, respondent, browserErrors }) => {
    const sessionStarts = recordRequests(page, isCreateSessionRequest);

    await page.goto(respondent.questionnairePath("not-a-questionnaire-id"));

    await expect(respondent.heading(RESPONDENT_HEADINGS.notFound)).toBeVisible();
    expect(sessionStarts).toEqual([]);
    expect(browserErrors.pageErrors).toEqual([]);
    expect(browserErrors.consoleErrors).toEqual([]);
  });
});
