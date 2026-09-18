import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const DRAFT_EDITOR_SCREEN = "apps/admin/src/screens/draft-editor.tsx";
const DRAFT_EDITOR_OWN_FILE = "apps/admin/src/screens/draft-editor/draft-items.tsx";
const QUESTION_BANK_OWN_FILE = "apps/admin/src/screens/question-bank/bank-display.ts";
const LIB_FILE = "apps/admin/src/lib/dates.ts";
const COMPONENT_FILE = "apps/admin/src/components/pill.tsx";
const API_FILE = "apps/admin/src/api/queries.ts";
const FEATURE_FILE = "apps/admin/src/features/question-editor/question-form.ts";
const OTHER_SCREEN_FILE = "apps/admin/src/screens/version-history.tsx";

describe("L3: a private screen directory is imported only by its own screen", () => {
  it.each([
    ["../screens/draft-editor/draft-changes", LIB_FILE],
    ["../../screens/draft-editor/draft-changes", COMPONENT_FILE],
    ["../../screens/draft-editor/draft-changes", API_FILE],
    ["../../screens/draft-editor/draft-changes", FEATURE_FILE],
  ])("rejects %s from %s", async (source, filePath) => {
    expect(await restrictedImports(filePath, `import { x } from "${source}";`)).toHaveLength(1);
  });

  it("rejects one private screen reaching into another", async () => {
    expect(
      await restrictedImports(QUESTION_BANK_OWN_FILE, `import { x } from "../questionnaire-list/summary-display";`),
    ).toHaveLength(1);
    expect(await restrictedImports(OTHER_SCREEN_FILE, `import { x } from "./draft-editor/draft-changes";`)).toHaveLength(1);
  });

  it("allows the screen's own top-level file and its own subdirectory files to import each other", async () => {
    expect(
      await restrictedImports(DRAFT_EDITOR_SCREEN, `import { addItem } from "./draft-editor/draft-changes";`),
    ).toEqual([]);
    expect(
      await restrictedImports(DRAFT_EDITOR_OWN_FILE, `import { addItem } from "./draft-changes";`),
    ).toEqual([]);
  });

  it("leaves lib, components, api and features free to import each other and unrelated screens' top-level files", async () => {
    expect(await restrictedImports(LIB_FILE, `import { x } from "../components/pill";`)).toEqual([]);
    expect(await restrictedImports(COMPONENT_FILE, `import { x } from "../lib/dates";`)).toEqual([]);
    expect(await restrictedImports(FEATURE_FILE, `import { x } from "../../api/queries";`)).toEqual([]);
  });

  it("does not reach admin's tests, which unit-test a screen's own internals", async () => {
    expect(
      await restrictedImports(
        "apps/admin/_tests/screens/draft-editor/draft-changes.test.ts",
        `import { addItem } from "../../../src/screens/draft-editor/draft-changes";`,
      ),
    ).toEqual([]);
  });

  it("does not trip on unrelated paths that merely contain a screen's name", async () => {
    expect(await restrictedImports(LIB_FILE, `import { x } from "./question-bank-summary";`)).toEqual([]);
  });
});
