import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const ADMIN_SRC = "apps/admin/src/screens/version-preview/version-preview.tsx";
const ADMIN_TEST = "apps/admin/_tests/screens/version-preview.test.tsx";
const RESPONDENT_SRC = "apps/respondent/src/screens/questionnaire-screen.tsx";
const RESPONDENT_TEST = "apps/respondent/_tests/screens/questionnaire-screen.test.tsx";

describe("L12: no deep imports into packages/ui internals", () => {
  it.each([
    ["a relative path from admin", ADMIN_SRC, `import { itemErrorMessage } from "../../../../packages/ui/src/questionnaire/messages";`],
    ["a relative path from an admin test", ADMIN_TEST, `import { itemErrorMessage } from "../../../packages/ui/src/questionnaire/messages";`],
    ["a relative path from respondent", RESPONDENT_SRC, `import { itemErrorMessage } from "../../../../packages/ui/src/questionnaire/messages";`],
    ["a relative path from a respondent test", RESPONDENT_TEST, `import { itemErrorMessage } from "../../../packages/ui/src/questionnaire/messages";`],
    ["a relative path through a ./ segment", ADMIN_SRC, `import { itemErrorMessage } from "../../../../packages/./ui/src/questionnaire/messages";`],
    ["a bare import past the questionnaire entry", ADMIN_SRC, `import { itemErrorMessage } from "@qp/ui/questionnaire/messages";`],
    ["a bare import past the testing entry", RESPONDENT_TEST, `import { axeViolations } from "@qp/ui/testing/axe";`],
  ])("rejects %s", async (_, filePath, code) => {
    const messages = await restrictedImports(filePath, code);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Apps reach @qp/ui only through the entry points");
  });

  it("allows the declared entry points, bare and wildcard", async () => {
    const code = [
      `import { QuestionnaireForm } from "@qp/ui/questionnaire";`,
      `import { Button } from "@qp/ui/primitives/button";`,
      `import { cn } from "@qp/ui/lib/utils";`,
      `import "@qp/ui/globals.css";`,
    ].join("\n");

    expect(await restrictedImports(ADMIN_SRC, code)).toEqual([]);
    expect(await restrictedImports(RESPONDENT_SRC, code)).toEqual([]);
  });

  it("leaves packages/ui's own relative imports alone", async () => {
    const code = `import { itemErrorMessage } from "./messages";`;

    expect(await restrictedImports("packages/ui/src/questionnaire/errors-by-item-id.ts", code)).toEqual([]);
    expect(await restrictedImports("packages/ui/_tests/questionnaire/messages.test.tsx", `import { itemErrorMessage } from "../../src/questionnaire";`)).toEqual([]);
  });

  it("still rejects pino and the app's own library split, which this block inherits", async () => {
    expect(await restrictedImports(ADMIN_SRC, `import pino from "pino";`)).toHaveLength(1);
    expect(await restrictedImports(ADMIN_SRC, `import { useForm } from "@tanstack/react-form";`)).toHaveLength(1);
    expect(await restrictedImports(RESPONDENT_SRC, `import { useQuery } from "@tanstack/react-query";`)).toHaveLength(1);
  });
});
