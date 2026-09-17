import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function consoleMessages(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-console").map((m) => m.message);
}

const LOG = `export const report = () => console.log("hello");`;

describe("console stays out of src", () => {
  it.each([
    ["the backend", "apps/backend/src/server.ts"],
    ["a backend repository", "apps/backend/src/db/execution/responses.ts"],
    ["the admin app", "apps/admin/src/api/client.ts"],
    ["the respondent app", "apps/respondent/src/storage/partials.ts"],
    ["packages/shared", "packages/shared/src/engine.ts"],
    ["packages/ui", "packages/ui/src/renderer/question.tsx"],
  ])("rejects console.log in %s", async (_, filePath) => {
    expect(await consoleMessages(filePath, LOG)).toHaveLength(1);
  });

  it.each([
    ["console.error", `export const report = () => console.error("x");`],
    ["console.warn", `export const report = () => console.warn("x");`],
    ["console.debug", `export const report = () => console.debug("x");`],
  ])("rejects %s too", async (_, code) => {
    expect(await consoleMessages("apps/backend/src/server.ts", code)).toHaveLength(1);
  });

  it.each([
    ["the migration entry point", "apps/backend/src/db/migrate.ts"],
    ["the seed entry point", "apps/backend/src/db/seed/seed.ts"],
    ["the stack CLI", "e2e/stack/stack-cli.ts"],
    ["the e2e global setup", "e2e/stack/global-setup.ts"],
    ["the e2e global teardown", "e2e/stack/global-teardown.ts"],
  ])("allows it in %s, which writes to a terminal", async (_, filePath) => {
    expect(await consoleMessages(filePath, LOG)).toEqual([]);
  });

  it("reaches the rest of e2e, which reports through Playwright", async () => {
    expect(await consoleMessages("e2e/fixtures/pages/respondent-page.ts", LOG)).toHaveLength(1);
    expect(await consoleMessages("e2e/stack/compose-stack.ts", LOG)).toHaveLength(1);
  });

  it("does not reach a package's _tests directory", async () => {
    expect(await consoleMessages("apps/backend/_tests/db/harness.ts", LOG)).toEqual([]);
  });

  it("leaves a method named log on something else alone", async () => {
    const code = `declare const logger: { log: (m: string) => void };\nexport const report = () => logger.log("x");`;

    expect(await consoleMessages("apps/backend/src/server.ts", code)).toEqual([]);
  });
});
