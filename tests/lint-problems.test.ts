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
    expect(messages[0]?.message).toContain("built in one place");
  });

  it("allows building any other slug", async () => {
    const code = 'import { problem } from "@qp/shared";\nexport const stale = problem("questionnaire/draft-stale", {});';

    expect(await restrictedSyntax(code)).toEqual([]);
  });

  it("reaches apps/backend/src, keeping the raw SQL and connection restrictions that already apply there", async () => {
    const backend = "apps/backend/src/modules/definition/routes/example.ts";

    expect(await restrictedSyntax(valueCheck, backend)).toHaveLength(1);
    expect(await restrictedSyntax('import { sql } from "drizzle-orm";\nexport const q = sql`SELECT 1`;', backend)).toHaveLength(1);
    expect(await restrictedSyntax('import { Pool } from "pg";\nexport const p = new Pool();', backend)).toHaveLength(1);
  });

  it("reaches the schema declaration and the connection constructor without taking away their own exemptions", async () => {
    const rawSql = 'import { sql } from "drizzle-orm";\nexport const q = sql`version >= 1`;';
    const newPool = 'import { Pool } from "pg";\nexport const p = new Pool();';

    expect(await restrictedSyntax(valueCheck, "apps/backend/src/db/schema.ts")).toHaveLength(1);
    expect(await restrictedSyntax(rawSql, "apps/backend/src/db/schema.ts")).toEqual([]);
    expect(await restrictedSyntax(valueCheck, "apps/backend/src/db/client.ts")).toHaveLength(1);
    expect(await restrictedSyntax(newPool, "apps/backend/src/db/client.ts")).toEqual([]);
  });

  it("leaves the six inline `resource/not-found` builders in apps/backend/src to PR 4b", async () => {
    expect(await restrictedSyntax(notFound, "apps/backend/src/modules/definition/routes/example.ts")).toEqual([]);
    expect(await restrictedSyntax(notFound, "apps/backend/src/http/problems.ts")).toEqual([]);
  });

  it("reaches e2e, whose three hand-parses this PR converted", async () => {
    expect(await restrictedSyntax(valueCheck, "e2e/fixtures/api/example.ts")).toHaveLength(1);
    expect(await restrictedSyntax(valueCheck, "e2e/specs/tier-2/support/example.ts")).toHaveLength(1);
    expect(await restrictedSyntax(valueCheck, "e2e/specs/tier-3/support/example.ts")).toHaveLength(1);
  });

  it("still lets the e2e entry points default-export, which extending the rule over e2e could have taken away", async () => {
    const defaultExport = "export default { use: {} };";

    for (const entryPoint of ["e2e/playwright.config.ts", "e2e/stack/global-setup.ts", "e2e/stack/global-teardown.ts"]) {
      expect(await restrictedSyntax(defaultExport, entryPoint)).toEqual([]);
      expect(await restrictedSyntax(valueCheck, entryPoint)).toHaveLength(1);
    }
  });

  it("still warns on a double assertion, a `:param` regex and a default export, which this block inherits", async () => {
    const code =
      'declare const a: string;\nexport const b = a as unknown as number;\nexport const p = "/:id".replace(/:(\\w+)/g, () => "x");\nexport default p;';

    expect(await restrictedSyntax(code)).toHaveLength(3);
  });
});
