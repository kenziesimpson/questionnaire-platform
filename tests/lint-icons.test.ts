import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

async function restrictedSyntax(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

const ICONS_MODULE = "packages/ui/src/icons.ts";
const PRIMITIVE = "packages/ui/src/primitives/native-select.tsx";
const RENDERER = "packages/ui/src/questionnaire/question.tsx";
const ADMIN = "apps/admin/src/screens/questionnaire-list.tsx";
const RESPONDENT = "apps/respondent/src/screens/questionnaire-screen.tsx";
const BACKEND = "apps/backend/src/server.ts";
const E2E = "e2e/specs/tier-1/questionnaire.spec.tsx";

const LUCIDE_IMPORT = `import { Lock } from "lucide-react";`;

describe("L2: icons only through @qp/ui/icons", () => {
  it("allows lucide-react in its two homes", async () => {
    expect(await restrictedImports(ICONS_MODULE, LUCIDE_IMPORT)).toEqual([]);
    expect(await restrictedImports(PRIMITIVE, LUCIDE_IMPORT)).toEqual([]);
  });

  it.each([
    ["packages/ui's own renderer", RENDERER],
    ["apps/admin", ADMIN],
    ["apps/respondent", RESPONDENT],
    ["the backend", BACKEND],
    ["e2e", E2E],
  ])("rejects lucide-react outside its homes: %s", async (_, filePath) => {
    const messages = await restrictedImports(filePath, LUCIDE_IMPORT);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("@qp/ui/icons");
  });

  it("covers subpaths", async () => {
    expect(await restrictedImports(ADMIN, `import { Lock } from "lucide-react/dist/esm/icons/lock";`)).toHaveLength(1);
  });

  it("still rejects pino and the app's own library split, which this block inherits", async () => {
    expect(await restrictedImports(ADMIN, `import pino from "pino";`)).toHaveLength(1);
    expect(await restrictedImports(ADMIN, `import { useForm } from "@tanstack/react-form";`)).toHaveLength(1);
  });

  it("allows @qp/ui/icons everywhere", async () => {
    const code = `import { LockIcon } from "@qp/ui/icons";`;

    expect(await restrictedImports(ADMIN, code)).toEqual([]);
    expect(await restrictedImports(RESPONDENT, code)).toEqual([]);
  });
});

const SVG_JSX = `export function Icon() { return <svg><path d="M0 0" /></svg>; }`;

describe("L2: no <svg> JSX outside packages/ui", () => {
  it.each([
    ["apps/admin", ADMIN],
    ["apps/respondent", RESPONDENT],
    ["e2e", E2E],
  ])("rejects a hand-drawn <svg> in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, SVG_JSX);

    expect(messages.some((message) => message.includes("<svg> is drawn only inside packages/ui"))).toBe(true);
  });

  it("allows a hand-drawn <svg> inside packages/ui", async () => {
    expect(await restrictedSyntax(RENDERER, SVG_JSX)).toEqual([]);
    expect(await restrictedSyntax(PRIMITIVE, SVG_JSX)).toEqual([]);
  });

  it("leaves other JSX elements alone", async () => {
    const code = `export function Icon() { return <div><span /></div>; }`;

    expect(await restrictedSyntax(ADMIN, code)).toEqual([]);
  });
});
