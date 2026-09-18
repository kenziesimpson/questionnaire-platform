import { expect, type Locator, type Page, type Request, type Response } from "@playwright/test";
import { definitionApi, routePath, type Question, type QuestionInput, type RouteDefinition } from "@qp/shared";
import { problemReplyOf, uniqueName, type ApiExchange, type DefinitionApi, type ProblemReply } from "../../../fixtures/index.ts";

const DRAFT_ITEM_LIST_NAME = "Questions, in the order respondents see them";

export const YES_NO_OPTION_IDS = { yes: "yes", no: "no" } as const;

export function yesNoQuestionInput(label: string): Extract<QuestionInput, { type: "single_choice" }> {
  return {
    type: "single_choice",
    prompt: uniqueName(label),
    options: [
      { optionId: YES_NO_OPTION_IDS.yes, label: "Yes" },
      { optionId: YES_NO_OPTION_IDS.no, label: "No" },
    ],
  };
}

export function textQuestionInput(label: string): Extract<QuestionInput, { type: "text" }> {
  return { type: "text", prompt: uniqueName(label) };
}

export async function createTextQuestions(api: DefinitionApi, labels: readonly string[]): Promise<Question[]> {
  return Promise.all(labels.map((label) => api.createQuestion(textQuestionInput(label))));
}

export function promptOf(question: Question): string {
  return question.latest.prompt;
}

export function problemReplyOfExchange(exchange: ApiExchange): ProblemReply {
  return problemReplyOf(exchange.status, exchange.body);
}

export async function problemReplyOfResponse(response: Response): Promise<ProblemReply> {
  return problemReplyOf(response.status(), await response.json());
}

export type RouteParams = Readonly<Record<string, string | number>>;

function definitionPath(route: RouteDefinition, params: RouteParams): string {
  return `${definitionApi.DEFINITION_PREFIX}${routePath(route.url, params)}`;
}

function isDefinitionCall(message: Request, route: RouteDefinition, params: RouteParams): boolean {
  return message.method() === route.method && new URL(message.url()).pathname === definitionPath(route, params);
}

export function definitionUrlPattern(route: RouteDefinition, params: RouteParams): string {
  return `**${definitionPath(route, params)}`;
}

export function waitForDefinitionResponse(page: Page, route: RouteDefinition, params: RouteParams): Promise<Response> {
  return page.waitForResponse((response) => isDefinitionCall(response.request(), route, params));
}

export function recordDefinitionRequests(page: Page, route: RouteDefinition, params: RouteParams): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (isDefinitionCall(request, route, params)) seen.push(request);
  });
  return seen;
}

export function draftItemList(page: Page): Locator {
  return page.getByRole("list", { name: DRAFT_ITEM_LIST_NAME, exact: true });
}

export function draftItemRow(page: Page, position: number, prompt: string): Locator {
  return draftItemList(page).getByRole("listitem", { name: `Question ${position}, ${prompt}`, exact: true });
}

export async function expectDraftItemOrder(page: Page, prompts: readonly string[]): Promise<void> {
  const rows = draftItemList(page).locator(":scope > li");
  await expect(rows).toHaveCount(prompts.length);
  for (const [index, prompt] of prompts.entries()) {
    await expect(rows.nth(index)).toHaveAccessibleName(`Question ${index + 1}, ${prompt}`);
  }
}

export function dragHandle(page: Page, position: number): Locator {
  return page.getByRole("button", { name: `Drag to reorder question ${position}`, exact: true });
}

export function reorderLiveRegion(page: Page): Locator {
  return page.getByRole("status").and(page.locator('[aria-live="assertive"]'));
}

export interface KeyboardMove {
  readonly prompt: string;
  readonly from: number;
  readonly to: number;
  readonly total: number;
}

const SENSOR_SETTLE_ATTEMPT_MS = 750;

async function pressUntilAnnounced(page: Page, key: string, announcement: string): Promise<void> {
  const announcements = reorderLiveRegion(page);
  await expect(async () => {
    if ((await announcements.textContent()) !== announcement) await page.keyboard.press(key);
    await expect(announcements).toHaveText(announcement, { timeout: SENSOR_SETTLE_ATTEMPT_MS });
  }).toPass();
}

export async function moveItemByKeyboard(page: Page, { prompt, from, to, total }: KeyboardMove): Promise<void> {
  await pressUntilAnnounced(page, "Space", `Picked up question “${prompt}”. It is in position ${from} of ${total}.`);
  const arrow = to > from ? "ArrowDown" : "ArrowUp";
  const step = to > from ? 1 : -1;
  for (let position = from + step; position !== to + step; position += step) {
    await pressUntilAnnounced(page, arrow, `Question “${prompt}” moved to position ${position} of ${total}.`);
  }
  await pressUntilAnnounced(page, "Space", `Question “${prompt}” was dropped in position ${to} of ${total}.`);
}

export async function tabUntilFocused(page: Page, target: Locator, maxPresses = 60): Promise<void> {
  for (let presses = 0; presses < maxPresses; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void = () => undefined;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}
