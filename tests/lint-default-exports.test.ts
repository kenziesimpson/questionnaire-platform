import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedSyntax(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

const DEFAULT_FUNCTION = `export default function setup(): void {}`;
const DEFAULT_VALUE = `export default { name: "x" };`;

describe("exports are named", () => {
  it.each([
    ["the backend", "apps/backend/src/http/routes.ts"],
    ["the admin app", "apps/admin/src/screens/questionnaire-list.tsx"],
    ["the respondent app", "apps/respondent/src/storage/partials.ts"],
    ["packages/shared", "packages/shared/src/engine.ts"],
    ["packages/ui", "packages/ui/src/primitives/dialog.tsx"],
    ["a package's tests", "apps/admin/_tests/fixtures.ts"],
    ["an e2e fixture", "e2e/fixtures/pages/respondent-page.ts"],
  ])("warns on a default export in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, DEFAULT_FUNCTION);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Exports are named");
  });

  it("warns on a default-exported value as well as a declaration", async () => {
    expect(await restrictedSyntax("packages/shared/src/engine.ts", DEFAULT_VALUE)).toHaveLength(1);
  });

  it.each([
    ["a vite config", "apps/admin/vite.config.ts"],
    ["a vitest config", "apps/backend/vitest.config.ts"],
    ["the root vitest config", "vitest.config.mts"],
    ["the drizzle config", "apps/backend/drizzle.config.ts"],
    ["the Playwright config", "e2e/playwright.config.ts"],
  ])("allows it in %s, which the tool loads as a default export", async (_, filePath) => {
    expect(await restrictedSyntax(filePath, DEFAULT_VALUE)).toEqual([]);
  });

  it.each([
    ["vitest's backend globalSetup", "apps/backend/_tests/db/global-setup.ts"],
    ["Playwright's globalSetup", "e2e/stack/global-setup.ts"],
    ["Playwright's globalTeardown", "e2e/stack/global-teardown.ts"],
  ])("allows it in %s, which the framework requires", async (_, filePath) => {
    expect(await restrictedSyntax(filePath, DEFAULT_FUNCTION)).toEqual([]);
  });

  it("leaves named exports alone", async () => {
    const code = `export const setup = (): void => {};\nexport type Setup = typeof setup;`;

    expect(await restrictedSyntax("apps/backend/src/http/routes.ts", code)).toEqual([]);
  });

  it("still warns on a double assertion, which this rule shares with the others", async () => {
    const code = `declare const a: string;\nexport const b = a as unknown as number;`;

    expect(await restrictedSyntax("packages/shared/src/engine.ts", code)).toHaveLength(1);
  });

  it("keeps raw SQL warnings in the files that must default-export", async () => {
    const code = `import { sql } from "drizzle-orm";\nexport default sql\`SELECT 1\`;`;

    expect(await restrictedSyntax("apps/backend/_tests/db/global-setup.ts", code)).toHaveLength(1);
  });
});

describe("exempting a file from the default-export rule removes only that selector", () => {
  const POOL = `import pg from "pg";\nexport default new pg.Pool({});`;
  const NAMED_POOL = `import { Pool } from "pg";\nexport default new Pool({});`;
  const RAW_SQL = `import { sql } from "drizzle-orm";\nexport default sql\`SELECT 1\`;`;

  it.each([
    ["the drizzle config", "apps/backend/drizzle.config.ts"],
    ["the backend vitest config", "apps/backend/vitest.config.ts"],
  ])("%s keeps the connection-construction and raw-SQL warnings", async (_, filePath) => {
    expect(await restrictedSyntax(filePath, POOL)).toHaveLength(1);
    expect(await restrictedSyntax(filePath, NAMED_POOL)).toHaveLength(1);
    expect(await restrictedSyntax(filePath, RAW_SQL)).toHaveLength(1);
  });

  it("a backend config file still default-exports its config without a warning", async () => {
    const code = `import { defineConfig } from "vitest/config";\nexport default defineConfig({});`;

    expect(await restrictedSyntax("apps/backend/vitest.config.ts", code)).toEqual([]);
  });

  it("the backend harness's globalSetup keeps its connection-construction exemption and its raw-SQL warning", async () => {
    expect(await restrictedSyntax("apps/backend/_tests/db/global-setup.ts", POOL)).toEqual([]);
    expect(await restrictedSyntax("apps/backend/_tests/db/global-setup.ts", NAMED_POOL)).toEqual([]);
    expect(await restrictedSyntax("apps/backend/_tests/db/global-setup.ts", RAW_SQL)).toHaveLength(1);
  });

  it.each([
    ["the Playwright config", "e2e/playwright.config.ts"],
    ["the packages/ui vitest config", "packages/ui/vitest.config.ts"],
    ["the root vitest config", "vitest.config.mts"],
  ])("%s carries no backend selector, as before the rule landed", async (_, filePath) => {
    expect(await restrictedSyntax(filePath, POOL)).toEqual([]);
    expect(await restrictedSyntax(filePath, RAW_SQL)).toEqual([]);
  });

  it("still warns on a double assertion in every exempted file", async () => {
    const code = `declare const a: string;\nexport const b = a as unknown as number;`;

    expect(await restrictedSyntax("apps/backend/drizzle.config.ts", code)).toHaveLength(1);
    expect(await restrictedSyntax("apps/backend/_tests/db/global-setup.ts", code)).toHaveLength(1);
    expect(await restrictedSyntax("e2e/playwright.config.ts", code)).toHaveLength(1);
  });
});
