import { expect, type Locator, type Page } from "@playwright/test";

export async function tabUntilFocused(page: Page, target: Locator, maxPresses = 60): Promise<void> {
  for (let presses = 0; presses < maxPresses; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}
