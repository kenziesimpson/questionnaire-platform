import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

const REPOSITORY = "apps/backend/src/db/definition/example.ts";
const TEST = "apps/backend/_tests/db/example.test.ts";
const FACTORY = "apps/backend/src/db/client.ts";
const HARNESS = "apps/backend/_tests/db/harness.ts";
const GLOBAL_SETUP = "apps/backend/_tests/db/global-setup.ts";

async function messages(rule: string, code: string, filePath: string) {
  return (await lintAs(filePath, code)).filter((message) => message.ruleId === rule);
}

const restrictedSyntax = (code: string, filePath = REPOSITORY) => messages("no-restricted-syntax", code, filePath);
const restrictedImports = (code: string, filePath = TEST) => messages("no-restricted-imports", code, filePath);

const NAMESPACED_CLIENT = 'import pg from "pg";\nexport const c = new pg.Client({ connectionString: "" });';
const NAMESPACED_POOL = 'import pg from "pg";\nexport const p = new pg.Pool({ connectionString: "" });';
const NAMED_CLIENT = 'import { Client } from "pg";\nexport const c = new Client({ connectionString: "" });';

describe("constructing a Postgres connection", () => {
  it.each([
    ["a namespaced client", NAMESPACED_CLIENT],
    ["a namespaced pool", NAMESPACED_POOL],
    ["a named client", NAMED_CLIENT],
  ])("warns on %s in backend sources", async (_, code) => {
    const found = await restrictedSyntax(code);

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("openDatabase");
  });

  it("warns in backend tests as well as sources", async () => {
    expect(await restrictedSyntax(NAMESPACED_CLIENT, TEST)).toHaveLength(1);
  });

  it.each([
    ["the factory, which is the constructor the rule points everything at", FACTORY],
    ["the harness, which needs a raw client to reach the postgres database", HARNESS],
    ["the harness globalSetup, which CREATEs the per-worker database before any pool of it can exist", GLOBAL_SETUP],
  ])("allows %s", async (_, filePath) => {
    expect(await restrictedSyntax(NAMESPACED_POOL, filePath)).toEqual([]);
    expect(await restrictedSyntax(NAMESPACED_CLIENT, filePath)).toEqual([]);
  });

  it("leaves openDatabase itself alone", async () => {
    const code = 'import { openDatabase } from "../client.js";\nexport const h = openDatabase("postgres://");';

    expect(await restrictedSyntax(code)).toEqual([]);
  });

  it("does not reach outside the backend", async () => {
    expect(await restrictedSyntax(NAMESPACED_CLIENT, "packages/shared/src/example.ts")).toEqual([]);
  });
});

describe("importing openDatabase", () => {
  it("is restricted in a backend test", async () => {
    const code = 'import { openDatabase } from "../../src/db/client.js";\nexport const o = openDatabase;';
    const found = await restrictedImports(code);

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("useTestDatabase()");
  });

  it("allows a type import from the same module", async () => {
    const code = 'import type { Database } from "../../src/db/client.js";\nexport type D = Database;';

    expect(await restrictedImports(code)).toEqual([]);
  });

  it("allows the harness to import it", async () => {
    const code = 'import { openDatabase } from "../../src/db/client.js";\nexport const o = openDatabase;';

    expect(await restrictedImports(code, HARNESS)).toEqual([]);
  });

  it("allows production to import it", async () => {
    const code = 'import { openDatabase } from "./db/client.js";\nexport const o = openDatabase;';

    expect(await restrictedImports(code, "apps/backend/src/index.ts")).toEqual([]);
  });
});
