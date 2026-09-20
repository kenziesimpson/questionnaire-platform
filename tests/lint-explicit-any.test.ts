import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function explicitAny(filePath: string, code: string) {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "@typescript-eslint/no-explicit-any");
}

describe("L15 — no explicit any", () => {
  it.each([
    ["a shared package test", "packages/shared/_tests/domain/schemas.test.ts"],
    ["shared sources", "packages/shared/src/engine/visibility.ts"],
    ["the admin app", "apps/admin/src/screens/draft-editor/conditions.ts"],
    ["the respondent app", "apps/respondent/src/storage/partials.ts"],
    ["packages/ui", "packages/ui/src/questionnaire/messages.ts"],
    ["the backend", "apps/backend/src/db/definition/drafts.ts"],
    ["an e2e fixture", "e2e/fixtures/demo/demo-questionnaire.ts"],
    ["a repo-level test", "tests/example.test.ts"],
  ])("rejects an explicit any in %s", async (_, filePath) => {
    const messages = await explicitAny(filePath, `export const mutate = (d: any) => d;`);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.severity).toBe(2);
  });

  it.each([
    ["an assertion", `declare const d: unknown;\nexport const e = d as any;`],
    ["a type argument", `export const list: Array<any> = [];`],
    ["an array element type", `export const list: any[] = [];`],
  ])("rejects any as %s", async (_, code) => {
    expect(await explicitAny("apps/admin/src/screens/draft-editor/conditions.ts", code)).toHaveLength(1);
  });

  it("allows unknown and a typed builder", async () => {
    const code = `export const mutate = (d: unknown): object => ({ ...(d as object), formatVersion: 2 });`;

    expect(await explicitAny("packages/shared/_tests/domain/schemas.test.ts", code)).toEqual([]);
  });
});
