import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });

const REPOSITORY = "apps/backend/src/db/definition/example.ts";

async function restrictedSyntax(code: string, filePath = REPOSITORY) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("raw SQL in the backend", () => {
  it.each([
    ["an sql template", 'import { sql } from "drizzle-orm";\nexport const q = sql`SELECT 1`;'],
    ["a typed sql template", 'import { sql } from "drizzle-orm";\nexport const q = sql<number>`count(*)`;'],
    ["sql.raw", 'import { sql } from "drizzle-orm";\nexport const q = sql.raw("now()");'],
    ["sql.identifier", 'import { sql } from "drizzle-orm";\nexport const q = sql.identifier("execution");'],
  ])("warns on %s", async (_, code) => {
    const messages = await restrictedSyntax(code);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.severity).toBe(1);
    expect(messages[0]?.message).toContain("Raw SQL");
  });

  it("warns in backend tests as well as sources", async () => {
    const code = 'import { sql } from "drizzle-orm";\nexport const q = sql`SELECT 1`;';

    expect(await restrictedSyntax(code, "apps/backend/_tests/db/example.test.ts")).toHaveLength(1);
  });

  it("allows the query builder, including exists and max", async () => {
    const code = 'import { and, eq, exists, max } from "drizzle-orm";\nexport const q = [and, eq, exists, max];';

    expect(await restrictedSyntax(code)).toEqual([]);
  });

  it("does not apply to the schema declaration, whose checks and defaults are SQL expressions", async () => {
    const code = 'import { sql } from "drizzle-orm";\nexport const check = sql`version >= 1`;';

    expect(await restrictedSyntax(code, "apps/backend/src/db/schema.ts")).toEqual([]);
  });

  it("does not apply outside the backend", async () => {
    const code = "const sql = (parts: TemplateStringsArray) => parts.join();\nexport const q = sql`x`;";

    expect(await restrictedSyntax(code, "packages/shared/src/engine/example.ts")).toEqual([]);
  });

  it("still warns on a double assertion in the backend, where this block replaces the base rule's options", async () => {
    const code = "declare const a: string;\nexport const b = a as unknown as number;";

    expect(await restrictedSyntax(code)).toHaveLength(1);
  });

  it("accepts a disable comment carrying a reason, and it counts as used", async () => {
    const code =
      'import { sql } from "drizzle-orm";\n// eslint-disable-next-line no-restricted-syntax -- the builder cannot call a Postgres function\nexport const q = sql`SELECT audit.record()`;';
    const [result] = await eslint.lintText(code, { filePath: REPOSITORY });

    expect(result?.messages ?? []).toEqual([]);
  });
});
