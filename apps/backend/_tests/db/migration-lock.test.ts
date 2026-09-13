import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../../src/db/migrator.js";

const LOCK_FILE = path.join(MIGRATIONS_FOLDER, "migrations.lock.json");

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(path.join(MIGRATIONS_FOLDER, file))).digest("hex");
}

const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8")) as Record<string, string>;

describe("committed migrations", () => {
  it.each(Object.entries(lock))("%s is still present and byte-for-byte unchanged", (file, lockedHash) => {
    expect(existsSync(path.join(MIGRATIONS_FOLDER, file)), `${file} is locked but missing`).toBe(true);
    expect(
      sha256Of(file),
      `${file} changed after it was committed. Drizzle never re-runs an applied migration, so write a new migration instead of editing this one.`,
    ).toBe(lockedHash);
  });

  it("are all listed in migrations.lock.json", () => {
    const unlocked = readdirSync(MIGRATIONS_FOLDER)
      .filter((file) => file.endsWith(".sql") && !(file in lock))
      .map((file) => `"${file}": "${sha256Of(file)}"`);
    expect(
      unlocked,
      `Add these new migrations to apps/backend/drizzle/migrations.lock.json once reviewed:\n${unlocked.join(",\n")}`,
    ).toEqual([]);
  });
});
