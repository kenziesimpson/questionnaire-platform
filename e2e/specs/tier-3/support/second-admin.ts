import { AdminPage, test } from "../../../fixtures/index.ts";

export interface SecondAdminFixtures {
  readonly secondAdmin: AdminPage;
}

export const testWithSecondAdmin = test.extend<SecondAdminFixtures>({
  secondAdmin: async ({ secondContext }, use) => {
    const context = await secondContext();
    await use(new AdminPage(await context.newPage()));
  },
});
