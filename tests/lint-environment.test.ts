import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function environmentMessages(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code))
    .filter((m) => m.ruleId === "no-restricted-properties")
    .map((m) => m.message);
}

const READER = "apps/backend/src/config.ts";

const READ = `export const level = process.env.LOG_LEVEL ?? "info";`;
const INDEXED = `export const level = process.env["LOG_LEVEL"] ?? "info";`;

describe("process.env is read only by the backend's config module and by tool config files", () => {
  it("rejects a read anywhere else under src, by property and by index", async () => {
    for (const code of [READ, INDEXED]) {
      expect(await environmentMessages("apps/backend/src/db/client.ts", code)).toHaveLength(1);
      expect(await environmentMessages("apps/backend/src/modules/definition/plugin.ts", code)).toHaveLength(1);
      expect(await environmentMessages("apps/admin/src/api/client.ts", code)).toHaveLength(1);
      expect(await environmentMessages("apps/respondent/src/storage/partials.ts", code)).toHaveLength(1);
      expect(await environmentMessages("packages/shared/src/primitives.ts", code)).toHaveLength(1);
    }
  });

  it("allows it in the backend's config module", async () => {
    expect(await environmentMessages(READER, READ)).toEqual([]);
    expect(await environmentMessages(READER, INDEXED)).toEqual([]);
  });

  it("allows it in tool config files, which are not application code", async () => {
    expect(await environmentMessages("apps/backend/drizzle.config.ts", READ)).toEqual([]);
    expect(await environmentMessages("apps/admin/vite.config.ts", READ)).toEqual([]);
    expect(await environmentMessages("e2e/playwright.config.ts", READ)).toEqual([]);
  });

  it("does not reach tests or the e2e stack, which set the environment up for a process they start", async () => {
    expect(await environmentMessages("apps/backend/_tests/db/harness.ts", READ)).toEqual([]);
    expect(await environmentMessages("e2e/stack/compose-stack.ts", READ)).toEqual([]);
  });

  it("leaves the other two seams enforced in the files that own one of them", async () => {
    const localStorageRead = `export const raw = window.localStorage.getItem("qp");`;
    const fetchCall = `export const load = () => window.fetch("/api");`;

    expect(await environmentMessages(READER, localStorageRead)).toHaveLength(1);
    expect(await environmentMessages(READER, fetchCall)).toHaveLength(1);
    expect(await environmentMessages("apps/respondent/src/storage/partials.ts", fetchCall)).toHaveLength(1);
    expect(await environmentMessages("apps/admin/src/api/client.ts", localStorageRead)).toHaveLength(1);
  });
});
