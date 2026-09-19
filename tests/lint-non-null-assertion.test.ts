import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function nonNullAssertion(filePath: string, code: string) {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "@typescript-eslint/no-non-null-assertion");
}

describe("L14 — no non-null assertions", () => {
  it.each([
    ["a shared package test", "packages/shared/_tests/domain/schemas.test.ts"],
    ["shared sources", "packages/shared/src/engine/visibility.ts"],
    ["the admin app", "apps/admin/src/screens/draft-editor/conditions.ts"],
    ["the respondent app", "apps/respondent/src/storage/partials.ts"],
    ["packages/ui", "packages/ui/src/questionnaire/messages.ts"],
    ["the backend", "apps/backend/src/db/definition/drafts.ts"],
    ["an e2e fixture", "e2e/fixtures/demo/demo-questionnaire.ts"],
    ["a repo-level test", "tests/example.test.ts"],
  ])("rejects a non-null assertion in %s", async (_, filePath) => {
    const messages = await nonNullAssertion(filePath, `declare const d: string | undefined;\nexport const e = d!;`);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.severity).toBe(2);
  });

  it("rejects a non-null assertion on a member access", async () => {
    const code = `declare const d: { value?: string };\nexport const e = d.value!;`;

    expect(await nonNullAssertion("apps/admin/src/screens/draft-editor/conditions.ts", code)).toHaveLength(1);
  });

  it("allows a real guard instead", async () => {
    const code = `declare const d: string | undefined;\nexport const e = d === undefined ? "" : d;`;

    expect(await nonNullAssertion("packages/shared/_tests/domain/schemas.test.ts", code)).toEqual([]);
  });
});
