import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const LEAK_MODULE = "@qp/telemetry/leak-test";

function trackedTestFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", "*.test.ts", "*.test.tsx"], { cwd: repoRoot });
  return output
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0 && !path.startsWith("tests/"))
    .sort();
}

function selectorOfLeakScript(): string {
  const manifest: { scripts: Record<string, string> } = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const script = manifest.scripts["test:leak-test"];
  const selector = script?.match(/^vitest run (\S+)$/)?.[1];
  if (selector === undefined) throw new Error(`test:leak-test is ${String(script)}, expected "vitest run <path filter>"`);
  return selector;
}

describe("the leak-test gate selects every leak test", () => {
  const selector = selectorOfLeakScript();
  const leakTests = trackedTestFiles().filter((path) => readFileSync(resolve(repoRoot, path), "utf8").includes(LEAK_MODULE));

  it("finds the leak tests to check", () => {
    expect(leakTests.length).toBeGreaterThan(0);
  });

  it.each(leakTests.map((path) => [path] as const))("%s has the gate's path filter in its path", (path) => {
    expect(path, `npm run test:leak-test selects by "${selector}", so a test importing ${LEAK_MODULE} must carry it in its path`).toContain(
      selector,
    );
  });
});
