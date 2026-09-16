import { AdminPage, test } from "../../../fixtures/index.ts";

export interface SecondAdminFixtures {
  readonly secondAdmin: AdminPage;
}

export const testWithSecondAdmin = test.extend<SecondAdminFixtures>({
  secondAdmin: async ({ browser, stack }, use) => {
    const context = await browser.newContext({ baseURL: stack.baseUrl, reducedMotion: "reduce" });
    await use(new AdminPage(await context.newPage()));
    await context.close();
  },
});
