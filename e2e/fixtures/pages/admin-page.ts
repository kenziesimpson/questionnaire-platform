import { expect, type Locator, type Page } from "@playwright/test";

export const ADMIN_BASE_PATH = "/admin";

export const ADMIN_HEADINGS = {
  questionnaires: "Questionnaires",
  questionBank: "Question bank",
  versionHistory: "Version history",
  notFound: "Page not found",
  responses: "Responses",
} as const;

export interface ResponsesSearch {
  readonly version?: number;
  readonly status?: string;
  readonly sort?: string;
  readonly order?: string;
  readonly cursor?: string;
}

function responsesSearchString(search: ResponsesSearch): string {
  const params = new URLSearchParams();
  if (search.version !== undefined) params.set("version", String(search.version));
  if (search.status !== undefined) params.set("status", search.status);
  if (search.sort !== undefined) params.set("sort", search.sort);
  if (search.order !== undefined) params.set("order", search.order);
  if (search.cursor !== undefined) params.set("cursor", search.cursor);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export type ResponsesSortColumn = "Started" | "Submitted";

export const ADMIN_PATHS = {
  root: `${ADMIN_BASE_PATH}/`,
  questionnaires: `${ADMIN_BASE_PATH}/questionnaires`,
  questionBank: `${ADMIN_BASE_PATH}/questions`,
  draftEditor: (questionnaireId: string) => `${ADMIN_BASE_PATH}/questionnaires/${questionnaireId}/draft`,
  versionHistory: (questionnaireId: string) => `${ADMIN_BASE_PATH}/questionnaires/${questionnaireId}/versions`,
  versionPreview: (questionnaireId: string, version: number) => `${ADMIN_BASE_PATH}/questionnaires/${questionnaireId}/versions/${version}`,
  responsesList: (questionnaireId: string, search: ResponsesSearch = {}) =>
    `${ADMIN_BASE_PATH}/questionnaires/${questionnaireId}/responses${responsesSearchString(search)}`,
  responseDetail: (questionnaireId: string, sessionId: string, search: ResponsesSearch = {}) =>
    `${ADMIN_BASE_PATH}/questionnaires/${questionnaireId}/responses/${sessionId}${responsesSearchString(search)}`,
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

  async openResponsesList(questionnaireId: string, search: ResponsesSearch = {}): Promise<void> {
    await this.page.goto(ADMIN_PATHS.responsesList(questionnaireId, search));
    await expect(this.heading(ADMIN_HEADINGS.responses)).toBeVisible();
  }

  async openResponseDetail(questionnaireId: string, sessionId: string, search: ResponsesSearch = {}): Promise<void> {
    await this.page.goto(ADMIN_PATHS.responseDetail(questionnaireId, sessionId, search));
    await expect(this.sessionPanel()).toBeVisible();
  }

  responsesLink(questionnaireName: string): Locator {
    return this.page.getByRole("link", { name: `Responses of ${questionnaireName}`, exact: true });
  }

  rawResponsesLink(): Locator {
    return this.page.getByRole("link", { name: "Raw responses", exact: true });
  }

  sessionRow(sessionId: string): Locator {
    return this.page.getByRole("row").filter({ has: this.page.getByTitle(sessionId, { exact: true }) });
  }

  openSessionButton(sessionId: string): Locator {
    return this.page.getByRole("link", { name: `Open session ${sessionId.slice(0, 8)}`, exact: true });
  }

  versionFilter(): Locator {
    return this.page.getByLabel("Version", { exact: true });
  }

  statusFilter(): Locator {
    return this.page.getByLabel("Status", { exact: true });
  }

  previousPageButton(): Locator {
    return this.page.getByRole("button", { name: "Previous", exact: true });
  }

  nextPageButton(): Locator {
    return this.page.getByRole("button", { name: "Next", exact: true });
  }

  backToFirstPageButton(): Locator {
    return this.page.getByRole("button", { name: "Back to the first page", exact: true });
  }

  previousSessionButton(): Locator {
    return this.page
      .getByRole("link", { name: "Previous session", exact: true })
      .or(this.page.getByRole("button", { name: "Previous session", exact: true }));
  }

  nextSessionButton(): Locator {
    return this.page
      .getByRole("link", { name: "Next session", exact: true })
      .or(this.page.getByRole("button", { name: "Next session", exact: true }));
  }

  sortHeader(column: ResponsesSortColumn): Locator {
    return this.page.getByRole("columnheader", { name: column, exact: true });
  }

  sortButton(column: ResponsesSortColumn): Locator {
    return this.sortHeader(column).getByRole("button", { name: column, exact: true });
  }

  async sessionIdsInRowOrder(): Promise<string[]> {
    const links = await this.page.getByRole("link", { name: /^Open session / }).all();
    const labels = await Promise.all(links.map((link) => link.getAttribute("aria-label")));
    return labels.map((label) => (label ?? "").replace("Open session ", ""));
  }

  sessionPanel(): Locator {
    return this.page.getByRole("region", { name: "Session", exact: true });
  }
}
