import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

const STORAGE_RULES = new Set(["no-restricted-globals", "no-restricted-properties"]);

async function storageMessages(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code))
    .filter((m) => m.ruleId !== null && STORAGE_RULES.has(m.ruleId))
    .map((m) => m.message);
}

const SEAM = "apps/respondent/src/storage/partials.ts";
const SCREEN = "apps/respondent/src/screens/questionnaire-screen.tsx";

const BARE = `export const raw = localStorage.getItem("qp");`;
const THROUGH_WINDOW = `export const raw = window.localStorage.getItem("qp");`;
const THROUGH_GLOBAL_THIS = `export const raw = globalThis.localStorage.getItem("qp");`;

describe("localStorage stays inside the respondent's persistence seam", () => {
  it.each([
    ["a bare reference", BARE],
    ["window.localStorage", THROUGH_WINDOW],
    ["globalThis.localStorage", THROUGH_GLOBAL_THIS],
  ])("rejects %s elsewhere in a src directory", async (_, code) => {
    expect(await storageMessages(SCREEN, code)).toHaveLength(1);
    expect(await storageMessages("apps/admin/src/api/client.ts", code)).toHaveLength(1);
    expect(await storageMessages("packages/ui/src/renderer/question.tsx", code)).toHaveLength(1);
  });

  it.each([
    ["a bare reference", BARE],
    ["window.localStorage", THROUGH_WINDOW],
    ["globalThis.localStorage", THROUGH_GLOBAL_THIS],
  ])("allows %s in apps/respondent/src/storage", async (_, code) => {
    expect(await storageMessages(SEAM, code)).toEqual([]);
  });

  it("does not reach tests, which set up and assert on the browser's storage", async () => {
    expect(await storageMessages("apps/respondent/_tests/app.test.tsx", BARE)).toEqual([]);
    expect(await storageMessages("apps/respondent/_tests/storage/partials.test.ts", BARE)).toEqual([]);
  });

  it("does not reach e2e, whose page.evaluate callbacks run in the browser", async () => {
    const code = `export const read = (page: { evaluate: (f: () => string | null) => Promise<string | null> }) =>\n  page.evaluate(() => window.localStorage.getItem("qp"));`;

    expect(await storageMessages("e2e/fixtures/pages/respondent-page.ts", code)).toEqual([]);
  });

  it("leaves other storage-shaped names alone", async () => {
    const code = `declare const store: { getItem: (k: string) => string | null };\nexport const raw = store.getItem("qp");`;

    expect(await storageMessages(SCREEN, code)).toEqual([]);
  });
});
