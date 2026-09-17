import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

const CALLS_FETCH = 'export const load = () => fetch("/api/definition/questionnaires");';

async function restrictedGlobals(filePath: string, code = CALLS_FETCH) {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-globals");
}

describe("L16 — fetch only in API client modules", () => {
  it.each([
    ["an admin screen", "apps/admin/src/screens/example.tsx"],
    ["a respondent session module", "apps/respondent/src/session/example.ts"],
    ["packages/ui", "packages/ui/src/questionnaire/example.ts"],
    ["the backend", "apps/backend/src/modules/definition/example.ts"],
    ["an app test", "apps/admin/_tests/example.test.ts"],
    ["an e2e spec", "e2e/specs/tier-1/example.spec.ts"],
  ])("rejects fetch in %s", async (_, filePath) => {
    const messages = await restrictedGlobals(filePath);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.severity).toBe(2);
    expect(messages[0]?.message).toContain("API client");
  });

  it.each([
    ["the admin API client", "apps/admin/src/api/client.ts"],
    ["the respondent API client", "apps/respondent/src/api/request.ts"],
    ["the e2e fixtures", "e2e/fixtures/api/example.ts"],
    ["the e2e stack helpers", "e2e/stack/example.ts"],
  ])("allows fetch in %s", async (_, filePath) => {
    expect(await restrictedGlobals(filePath)).toEqual([]);
  });

  it("allows `typeof fetch` in a test double's type, which names no transport", async () => {
    const code = 'import { vi, type Mock } from "vitest";\nexport const fetchMock: Mock<typeof fetch> = vi.fn();';

    expect(await restrictedGlobals("apps/respondent/_tests/api/example.test.ts", code)).toEqual([]);
  });
});
