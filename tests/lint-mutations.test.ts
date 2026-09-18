import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const USE_MUTATION = `import { useMutation } from "@tanstack/react-query";`;

describe("L4: useMutation is imported only in src/api/mutations", () => {
  it.each([
    "apps/admin/src/screens/questionnaire-list/closes-at-dialog.tsx",
    "apps/admin/src/screens/draft-editor.tsx",
    "apps/admin/src/features/question-editor/question-editor-dialog.tsx",
    "apps/admin/src/api/queries.ts",
    "apps/admin/src/api/client.ts",
    "apps/admin/src/lib/dates.ts",
    "apps/admin/src/components/pill.tsx",
  ])("rejects it in %s", async (filePath) => {
    expect(await restrictedImports(filePath, USE_MUTATION)).toHaveLength(1);
  });

  it("allows it inside src/api/mutations", async () => {
    expect(
      await restrictedImports("apps/admin/src/api/mutations/use-save-question.ts", USE_MUTATION),
    ).toEqual([]);
  });

  it("still allows the rest of the react-query import surface elsewhere", async () => {
    const code = `import { useQuery, useQueryClient } from "@tanstack/react-query";`;
    expect(await restrictedImports("apps/admin/src/screens/questionnaire-list.tsx", code)).toEqual([]);
  });

  it("does not reach admin's tests", async () => {
    expect(await restrictedImports("apps/admin/_tests/api/mutations/use-draft-mutation.test.tsx", USE_MUTATION)).toEqual(
      [],
    );
  });
});
