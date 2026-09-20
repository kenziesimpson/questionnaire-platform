import { test as base, expect, type BrowserContext, type BrowserContextOptions } from "@playwright/test";
import { requireStackEndpoints, type StackEndpoints } from "../stack/stack-endpoints";
import { DefinitionApi } from "./api/definition-api";
import { ExecutionApi } from "./api/execution-api";
import { BrowserErrors } from "./browser-errors";
import { StackDatabase } from "./db/stack-database";
import { AdminPage } from "./pages/admin-page";
import { RespondentPage } from "./pages/respondent-page";

export interface SecondContextOptions {
  readonly storageState?: BrowserContextOptions["storageState"];
}

export type OpenSecondContext = (options?: SecondContextOptions) => Promise<BrowserContext>;

export interface StackWorkerFixtures {
  readonly stack: StackEndpoints;
  readonly db: StackDatabase;
}

export interface StackTestFixtures {
  readonly api: DefinitionApi;
  readonly execution: ExecutionApi;
  readonly browserErrors: BrowserErrors;
  readonly respondent: RespondentPage;
  readonly admin: AdminPage;
  readonly secondContext: OpenSecondContext;
}

export const test = base.extend<StackTestFixtures, StackWorkerFixtures>({
  stack: [
    async ({}, use) => {
      await use(requireStackEndpoints());
    },
    { scope: "worker" },
  ],

  db: [
    async ({ stack }, use) => {
      const database = new StackDatabase(stack.databaseUrl);
      await use(database);
      await database.close();
    },
    { scope: "worker" },
  ],

  baseURL: async ({ stack }, use) => {
    await use(stack.baseUrl);
  },

  api: async ({ playwright, stack }, use) => {
    const request = await playwright.request.newContext({ baseURL: stack.baseUrl });
    await use(new DefinitionApi(request));
    await request.dispose();
  },

  execution: async ({ playwright, stack }, use) => {
    const request = await playwright.request.newContext({ baseURL: stack.baseUrl });
    await use(new ExecutionApi(request));
    await request.dispose();
  },

  browserErrors: async ({ context, page }, use) => {
    const errors = new BrowserErrors();
    errors.watch(page);
    context.on("page", (opened) => errors.watch(opened));
    await use(errors);
  },

  respondent: async ({ page }, use) => {
    await use(new RespondentPage(page));
  },

  admin: async ({ page }, use) => {
    await use(new AdminPage(page));
  },

  secondContext: async ({ browser, stack }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({ baseURL: stack.baseUrl, reducedMotion: "reduce", ...options });
      opened.push(context);
      return context;
    });
    await Promise.all(opened.map((context) => context.close()));
  },
});

export { expect };
