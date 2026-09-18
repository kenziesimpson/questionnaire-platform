import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

const CALLS_FETCH = 'export const load = () => fetch("/api/definition/questionnaires");';

const TRANSPORT_RULES = ["no-restricted-globals", "no-restricted-properties"];

async function restrictedGlobals(filePath: string, code = CALLS_FETCH) {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId !== null && TRANSPORT_RULES.includes(m.ruleId));
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

  it("rejects fetch inside the respondent's persistence seam, which owns storage and not the transport", async () => {
    expect(await restrictedGlobals("apps/respondent/src/storage/partials.ts")).toHaveLength(1);
  });

  it.each([
    ["globalThis.fetch", 'export const load = () => globalThis.fetch("/api");'],
    ["window.fetch", 'export const load = () => window.fetch("/api");'],
  ])("rejects %s, which reaches the same transport around a bare reference", async (_, code) => {
    expect(await restrictedGlobals("apps/admin/src/screens/example.tsx", code)).toHaveLength(1);
    expect(await restrictedGlobals("apps/respondent/src/storage/partials.ts", code)).toHaveLength(1);
    expect(await restrictedGlobals("apps/admin/_tests/example.test.ts", code)).toHaveLength(1);
  });

  it.each([
    ["globalThis.fetch", 'export const load = () => globalThis.fetch("/api");'],
    ["window.fetch", 'export const load = () => window.fetch("/api");'],
  ])("allows %s in the modules that own the transport", async (_, code) => {
    expect(await restrictedGlobals("apps/admin/src/api/client.ts", code)).toEqual([]);
    expect(await restrictedGlobals("e2e/stack/example.ts", code)).toEqual([]);
  });
});

describe("L16 and L17 share no-restricted-globals without switching each other off", () => {
  const reads = (filePath: string, code: string) => lintAs(filePath, code).then((m) => m.filter((x) => x.ruleId === "no-restricted-globals"));

  const FETCH = 'export const load = () => fetch("/api/definition/questionnaires");';
  const STORE = 'export const raw = localStorage.getItem("qp");';

  it("confines both in a source file that owns neither seam", async () => {
    expect(await reads("apps/admin/src/screens/example.tsx", FETCH)).toHaveLength(1);
    expect(await reads("apps/admin/src/screens/example.tsx", STORE)).toHaveLength(1);
  });

  it("lets the API clients keep fetch while still confining localStorage", async () => {
    expect(await reads("apps/admin/src/api/client.ts", FETCH)).toEqual([]);
    expect(await reads("apps/admin/src/api/client.ts", STORE)).toHaveLength(1);
  });

  it("lets the persistence seam keep localStorage while still confining fetch", async () => {
    expect(await reads("apps/respondent/src/storage/partials.ts", STORE)).toEqual([]);
    expect(await reads("apps/respondent/src/storage/partials.ts", FETCH)).toHaveLength(1);
  });
});
