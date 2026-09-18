import { expect, type Locator, type Page } from "@playwright/test";

export const ADMIN_BASE_PATH = "/admin";

export const ADMIN_HEADINGS = {
  questionnaires: "Questionnaires",
  questionBank: "Question bank",
  versionHistory: "Version history",
  notFound: "Page not found",
} as const;

export const ADMIN_PATHS = {
  root: `${ADMIN_BASE_PATH}/`,
  questionnaires: `${ADMIN_BASE_PATH}/questionnaires`,
  questionBank: `${ADMIN_BASE_PATH}/questions`,
  draftEditor: (questionnaireId: string) => `${ADMIN_BASE_PATH}/questionnaires/${questionnaireId}/draft`,
  versionHistory: (questionnaireId: string) => `${ADMIN_BASE_PATH}/questionnaires/${questionnaireId}/versions`,
  versionPreview: (questionnaireId: string, version: number) => `${ADMIN_BASE_PATH}/questionnaires/${questionnaireId}/versions/${version}`,
} as const;

const DRAFT_ITEM_LIST_NAME = "Questions, in the order respondents see them";
const SENSOR_SETTLE_ATTEMPT_MS = 750;

export interface KeyboardMove {
  readonly prompt: string;
  readonly from: number;
  readonly to: number;
  readonly total: number;
}

export class AdminPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  heading(name: string | RegExp): Locator {
    return this.page.getByRole("heading", { level: 1, name });
  }

  mainNavigation(): Locator {
    return this.page.getByRole("navigation", { name: "Main" });
  }

  async openQuestionnaires(): Promise<void> {
    await this.page.goto(ADMIN_PATHS.questionnaires);
    await expect(this.heading(ADMIN_HEADINGS.questionnaires)).toBeVisible();
  }

  async openQuestionBank(): Promise<void> {
    await this.page.goto(ADMIN_PATHS.questionBank);
    await expect(this.heading(ADMIN_HEADINGS.questionBank)).toBeVisible();
  }

  async openDraftEditor(questionnaireId: string): Promise<void> {
    await this.page.goto(ADMIN_PATHS.draftEditor(questionnaireId));
    await expect(this.publishButton()).toBeVisible();
  }

  async openVersionHistory(questionnaireId: string): Promise<void> {
    await this.page.goto(ADMIN_PATHS.versionHistory(questionnaireId));
    await expect(this.heading(ADMIN_HEADINGS.versionHistory)).toBeVisible();
  }

  async openVersionPreview(questionnaireId: string, version: number): Promise<void> {
    await this.page.goto(ADMIN_PATHS.versionPreview(questionnaireId, version));
    await expect(this.heading(`Preview of version ${version}`)).toBeVisible();
  }

  questionnaireRow(name: string): Locator {
    return this.page.getByRole("row").filter({ has: this.page.getByText(name, { exact: true }) });
  }

  openDraftButton(questionnaireName: string): Locator {
    return this.page.getByRole("button", { name: `Open draft of ${questionnaireName}`, exact: true });
  }

  historyLink(questionnaireName: string): Locator {
    return this.page.getByRole("link", { name: `History of ${questionnaireName}`, exact: true });
  }

  nameLink(questionnaireName: string): Locator {
    return this.page.getByRole("link", { name: questionnaireName, exact: true });
  }

  copyLinkButton(questionnaireName: string): Locator {
    return this.page.getByRole("button", { name: `Copy link to ${questionnaireName}`, exact: true });
  }

  publishButton(): Locator {
    return this.page.getByRole("button", { name: "Publish", exact: true });
  }

  addQuestionButton(): Locator {
    return this.page.getByRole("button", { name: "Add question", exact: true });
  }

  draftItemsRegion(): Locator {
    return this.page.getByRole("region", { name: /^\d+ questions?$/ });
  }

  draftItemList(): Locator {
    return this.page.getByRole("list", { name: DRAFT_ITEM_LIST_NAME, exact: true });
  }

  draftItemRow(position: number, prompt: string): Locator {
    return this.draftItemList().getByRole("listitem", { name: `Question ${position}, ${prompt}`, exact: true });
  }

  async expectDraftItemOrder(prompts: readonly string[]): Promise<void> {
    const rows = this.draftItemList().locator(":scope > li");
    await expect(rows).toHaveCount(prompts.length);
    for (const [index, prompt] of prompts.entries()) {
      await expect(rows.nth(index)).toHaveAccessibleName(`Question ${index + 1}, ${prompt}`);
    }
  }

  dragHandle(position: number): Locator {
    return this.page.getByRole("button", { name: `Drag to reorder question ${position}`, exact: true });
  }

  reorderLiveRegion(): Locator {
    return this.page.getByRole("status").and(this.page.locator('[aria-live="assertive"]'));
  }

  private async pressUntilAnnounced(key: string, announcement: string): Promise<void> {
    const announcements = this.reorderLiveRegion();
    await expect(async () => {
      if ((await announcements.textContent()) !== announcement) await this.page.keyboard.press(key);
      await expect(announcements).toHaveText(announcement, { timeout: SENSOR_SETTLE_ATTEMPT_MS });
    }).toPass();
  }

  async moveItemByKeyboard({ prompt, from, to, total }: KeyboardMove): Promise<void> {
    await this.pressUntilAnnounced("Space", `Picked up question “${prompt}”. It is in position ${from} of ${total}.`);
    const arrow = to > from ? "ArrowDown" : "ArrowUp";
    const step = to > from ? 1 : -1;
    for (let position = from + step; position !== to + step; position += step) {
      await this.pressUntilAnnounced(arrow, `Question “${prompt}” moved to position ${position} of ${total}.`);
    }
    await this.pressUntilAnnounced("Space", `Question “${prompt}” was dropped in position ${to} of ${total}.`);
  }
}
