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
}
