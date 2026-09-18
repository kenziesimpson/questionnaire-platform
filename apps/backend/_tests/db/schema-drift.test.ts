import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../../src/db/migrations.js";

const BACKEND_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DRIZZLE_KIT_BIN = path.join(path.dirname(createRequire(import.meta.url).resolve("drizzle-kit")), "bin.cjs");

const scratchOut = mkdtempSync(path.join(tmpdir(), "qp-drizzle-drift-"));

afterAll(() => {
  rmSync(scratchOut, { recursive: true, force: true });
});

function listing(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: "utf8" }).sort();
}

describe("schema.ts and the committed migrations", () => {
  it("agree: drizzle-kit generate against a copy of the migrations has nothing to write", async () => {
    cpSync(MIGRATIONS_FOLDER, scratchOut, { recursive: true });
    const before = listing(scratchOut);

    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        DRIZZLE_KIT_BIN,
        "generate",
        "--dialect",
        "postgresql",
        "--casing",
        "snake_case",
        "--schema",
        "./src/db/schema.ts",
        "--out",
        path.relative(BACKEND_ROOT, scratchOut),
      ],
      { cwd: BACKEND_ROOT, timeout: 20_000 },
    );

    expect(stdout, "schema.ts has changes no committed migration carries; run npm run db:generate -w apps/backend").toContain(
      "No schema changes",
    );
    expect(listing(scratchOut)).toEqual(before);
  });
});
