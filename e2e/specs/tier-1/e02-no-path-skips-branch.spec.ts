import { createDemoShapedQuestionnaire, DEMO_ITEM_IDS, DEMO_OPTION_IDS, DEMO_V1, expect, test } from "../../fixtures/index";
import { RenderedTextWatch } from "./support/rendered-text-watch";

const prompts = DEMO_V1.prompts;
const NO = DEMO_V1.optionLabel(DEMO_OPTION_IDS.no);

test.describe("E2 — the no path skips the branch", () => {
  test("answering No keeps the branch out of the DOM and the accessibility tree, and persists only the two visible answers", async ({
    page,
    api,
    db,
    respondent,
    browserErrors,
  }) => {
    const demo = await createDemoShapedQuestionnaire(api, { name: "E2 no path" });
    const renderedText = await RenderedTextWatch.install(page);

    await respondent.openForm(demo.questionnaireId);
    const form = respondent.form(DEMO_V1.title);
    const hiddenPrompts = [prompts.whichCondition, prompts.diagnosedOn];

    for (const prompt of hiddenPrompts) {
      expect(await form.ariaSnapshot()).not.toContain(prompt);
      await expect(page.getByRole("radiogroup", { name: prompt, includeHidden: true })).toHaveCount(0);
      await expect(page.getByLabel(prompt)).toHaveCount(0);
    }

    await respondent.choose(prompts.hasCondition, NO);
    await expect(respondent.option(prompts.hasCondition, NO)).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("textbox", { name: prompts.pharmacy })).toBeFocused();
    await expect
      .poll(() => form.locator("[data-item-id]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-item-id"))))
      .toEqual([DEMO_ITEM_IDS.hasCondition, DEMO_ITEM_IDS.pharmacy]);

    const answeredSnapshot = await form.ariaSnapshot();
    expect(answeredSnapshot).toContain(prompts.hasCondition);
    expect(answeredSnapshot).toContain(prompts.pharmacy);
    for (const prompt of hiddenPrompts) {
      expect(answeredSnapshot).not.toContain(prompt);
      await expect(page.getByRole("radiogroup", { name: prompt, includeHidden: true })).toHaveCount(0);
      await expect(page.getByLabel(prompt)).toHaveCount(0);
    }

    await respondent.fillText(prompts.pharmacy, "Late-night chemist");
    const receipt = await respondent.submitAndExpectReceipt();

    expect(await renderedText.everRendered(prompts.hasCondition)).toBe(true);
    for (const prompt of hiddenPrompts) expect(await renderedText.everRendered(prompt)).toBe(false);

    expect(await db.session(receipt.sessionId)).toMatchObject({ questionnaireId: demo.questionnaireId, status: "submitted" });
    const responses = await db.responsesFor(receipt.sessionId);
    expect(responses).toEqual([
      expect.objectContaining({ itemId: DEMO_ITEM_IDS.hasCondition, optionIds: [DEMO_OPTION_IDS.no], otherText: null }),
      expect.objectContaining({ itemId: DEMO_ITEM_IDS.pharmacy, textValue: "Late-night chemist" }),
    ]);
    expect(responses.map((response) => response.itemId)).not.toContain(DEMO_ITEM_IDS.whichCondition);
    expect(responses.map((response) => response.itemId)).not.toContain(DEMO_ITEM_IDS.diagnosedOn);
    expect(browserErrors.summary()).toEqual({ consoleErrors: [], pageErrors: [] });
  });
});
