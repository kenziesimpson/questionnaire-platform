import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const TEXT_PATTERNS = ["*.ts", "*.tsx", "*.js", "*.mjs", "*.json", "*.md", "*.sql", "*.css"];

function trackedFiles(patterns: readonly string[]): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", ...patterns], { cwd: repoRoot });
  return output.toString("utf8").split("\0").filter((path) => path.length > 0);
}

function containsNul(path: string): boolean {
  return readFileSync(join(repoRoot, path)).includes(0);
}

describe("tracked source and docs are text", () => {
  const files = trackedFiles(TEXT_PATTERNS);

  it("finds the tracked text files to check", () => {
    expect(files).toContain("package.json");
    expect(files).toContain("packages/shared/src/engine/draft-validation.ts");
  });

  it("contains no NUL byte in any tracked source, config, SQL, CSS or Markdown file", () => {
    expect(files.filter(containsNul)).toEqual([]);
  });

  it("does not select binary assets such as images", () => {
    expect(files.some((path) => /\.(png|jpe?g|gif|ico|webp|woff2?)$/i.test(path))).toBe(false);
  });
});
