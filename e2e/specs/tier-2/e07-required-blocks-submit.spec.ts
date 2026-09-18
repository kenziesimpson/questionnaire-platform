import { DEMO_OPTION_IDS, DEMO_QUESTIONNAIRE_ID, DEMO_V1, expect, RESPONDENT_HEADINGS, test } from "../../fixtures/index.ts";
import { ERROR_SUMMARY_TITLES, ITEM_ERROR_MESSAGES } from "./support/respondent-messages.ts";
import { recordSubmitRequests } from "./support/submit-traffic.ts";

test.describe("E7 — a required answer blocks submit, and focus lands on it", () => {
  test("unanswered required items stop the submit in the browser, are summarised with jump controls, and take focus", async ({
    page,
    respondent,
    db,
  }) => {
    const submitRequests = recordSubmitRequests(page);
    await respondent.openForm(DEMO_QUESTIONNAIRE_ID);
    const { sessionId } = await respondent.waitForEnvelope(DEMO_QUESTIONNAIRE_ID);

    const { hasCondition, pharmacy } = DEMO_V1.prompts;
    const conditionGroup = respondent.choiceGroup(hasCondition);
    const pharmacyBox = page.getByRole("textbox", { name: pharmacy });
    const summary = respondent.errorSummary();

    await expect(pharmacyBox).not.toHaveAttribute("aria-invalid", "true");
    await expect(conditionGroup).not.toHaveAttribute("aria-invalid", "true");
    await expect(summary).toHaveCount(0);

    await pharmacyBox.focus();
    await pharmacyBox.blur();

    await expect(summary).toBeVisible();
    await expect(summary.getByRole("heading", { level: 2, name: ERROR_SUMMARY_TITLES.oneAnswer })).toBeVisible();
    await expect(pharmacyBox).toHaveAttribute("aria-invalid", "true");
    await expect(pharmacyBox).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.required);
    await expect(conditionGroup).not.toHaveAttribute("aria-invalid", "true");
    expect(submitRequests).toHaveLength(0);

    await respondent.submit();

    await expect(summary).toBeVisible();
    await expect(summary.getByRole("heading", { level: 2, name: ERROR_SUMMARY_TITLES.answers(2) })).toBeVisible();
    const summaryEntries = summary.getByRole("listitem");
    await expect(summaryEntries).toHaveText([
      `${hasCondition} — ${ITEM_ERROR_MESSAGES.required}`,
      `${pharmacy} — ${ITEM_ERROR_MESSAGES.required}`,
    ]);

    await expect(conditionGroup.getByRole("radio").and(page.locator(":focus"))).toHaveCount(1);
    await expect(respondent.option(hasCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes))).toBeFocused();

    await expect(conditionGroup).toHaveAttribute("aria-invalid", "true");
    await expect(conditionGroup).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.required);
    await expect(pharmacyBox).toHaveAttribute("aria-invalid", "true");
    await expect(pharmacyBox).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.required);

    await summary.getByRole("button", { name: pharmacy, exact: true }).click();
    await expect(pharmacyBox).toBeFocused();

    await respondent.choose(hasCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.no));
    await expect(conditionGroup).not.toHaveAttribute("aria-invalid", "true");
    await expect(summary.getByRole("heading", { level: 2, name: ERROR_SUMMARY_TITLES.oneAnswer })).toBeVisible();

    await respondent.submit();
    await expect(pharmacyBox).toBeFocused();
    await expect(summaryEntries).toHaveText([`${pharmacy} — ${ITEM_ERROR_MESSAGES.required}`]);
    await expect(pharmacyBox).toHaveAttribute("aria-invalid", "true");

    expect(submitRequests).toHaveLength(0);
    expect(await db.responsesFor(sessionId)).toEqual([]);
    expect(await db.session(sessionId)).toMatchObject({ status: "in_progress", submittedAt: null });

    await respondent.fillText(pharmacy, "Corner pharmacy");
    await expect(summary).toHaveCount(0);
    await expect(pharmacyBox).not.toHaveAttribute("aria-invalid", "true");

    const receipt = await respondent.submitAndExpectReceipt();
    expect(receipt.sessionId).toBe(sessionId);
    await expect(respondent.heading(RESPONDENT_HEADINGS.submitted)).toBeVisible();
    expect(submitRequests).toHaveLength(1);
  });
});
