import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

const ADMIN_API = "apps/admin/src/api/problem-error.ts";
const PARSER = "packages/shared/src/problems.ts";

async function restrictedSyntax(code: string, filePath = ADMIN_API) {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-syntax");
}

const valueCheck = 'import { ProblemDetails } from "@qp/shared";\nimport { Value } from "typebox/value";\nexport const ok = (b: unknown) => Value.Check(ProblemDetails, b);';
const codeGuard =
  'import { DRAFT_ITEM_CODES, type DraftItemCode } from "@qp/shared";\nexport function isDraftItemCode(code: string): code is DraftItemCode {\n  return DRAFT_ITEM_CODES.some((known) => known === code);\n}';
const notFound = 'import { problem } from "@qp/shared";\nexport const nf = problem("resource/not-found", { instance: "/x" });';

describe("L10 — problem bodies are parsed only by problemFromWire", () => {
  it.each([
    ["checking a body against ProblemDetails by hand", valueCheck],
    ["a hand-built item-code guard", codeGuard],
    [
      "a hand-built pointer-error guard",
      'import { type PointerError } from "@qp/shared";\nexport const isPointerError = (e: { pointer: string; code: string }): e is PointerError => e.code.startsWith("schema/");',
    ],
  ])("warns on %s in an app", async (_, code) => {
    const messages = await restrictedSyntax(code);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.severity).toBe(1);
    expect(messages[0]?.message).toContain("problemFromWire");
  });

  it("warns in the respondent and in packages/ui as well as in admin", async () => {
    expect(await restrictedSyntax(valueCheck, "apps/respondent/src/api/request.ts")).toHaveLength(1);
    expect(await restrictedSyntax(codeGuard, "packages/ui/src/questionnaire/example.ts")).toHaveLength(1);
  });

  it("allows the guards and the wire check inside problemFromWire's own module", async () => {
    expect(await restrictedSyntax(valueCheck, PARSER)).toEqual([]);
    expect(await restrictedSyntax(codeGuard, PARSER)).toEqual([]);
  });

  it("allows parsing through problemFromWire", async () => {
    const code =
      'import { problemFromWire } from "@qp/shared";\nexport const parse = (b: unknown) => problemFromWire(b, { unknownCodes: "drop" });';

    expect(await restrictedSyntax(code)).toEqual([]);
  });

  it("warns on building resource/not-found outside the one builder", async () => {
    const messages = await restrictedSyntax(notFound);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain("notFoundProblem");
  });

  it("allows building any other slug", async () => {
    const code = 'import { problem } from "@qp/shared";\nexport const stale = problem("questionnaire/draft-stale", {});';

    expect(await restrictedSyntax(code)).toEqual([]);
  });

  it("does not yet reach apps/backend/src, whose six inline builders PR 4b replaces with notFoundProblem", async () => {
    expect(await restrictedSyntax(notFound, "apps/backend/src/modules/definition/routes/example.ts")).toEqual([]);
  });

  it("does not yet reach e2e, which PR 16 folds into the shared parser", async () => {
    expect(await restrictedSyntax(valueCheck, "e2e/fixtures/api/example.ts")).toEqual([]);
  });

  it("still warns on a double assertion and a `:param` regex, which this block inherits", async () => {
    const code = 'declare const a: string;\nexport const b = a as unknown as number;\nexport const p = "/:id".replace(/:(\\w+)/g, () => "x");';

    expect(await restrictedSyntax(code)).toHaveLength(2);
  });
});
