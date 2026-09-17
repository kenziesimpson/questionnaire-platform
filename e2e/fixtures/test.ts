import { test as base, expect } from "@playwright/test";
import { requireStackEndpoints, type StackEndpoints } from "../stack/stack-endpoints.ts";
import { DefinitionApi } from "./api/definition-api.ts";
import { ExecutionApi } from "./api/execution-api.ts";
import { BrowserErrors } from "./browser-errors.ts";
import { StackDatabase } from "./db/stack-database.ts";
import { AdminPage } from "./pages/admin-page.ts";
import { RespondentPage } from "./pages/respondent-page.ts";

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
});

export { expect };
