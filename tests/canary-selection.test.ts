import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const CANARY_MODULE = "@qp/telemetry/canary";

function trackedTestFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", "*.test.ts", "*.test.tsx"], { cwd: repoRoot });
  return output
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0)
    .sort();
}

function selectorOfCanaryScript(): string {
  const manifest: { scripts: Record<string, string> } = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const script = manifest.scripts["test:canary"];
  const selector = script?.match(/^vitest run (\S+)$/)?.[1];
  if (selector === undefined) throw new Error(`test:canary is ${String(script)}, expected "vitest run <path filter>"`);
  return selector;
}

describe("the canary gate selects every canary test", () => {
  const selector = selectorOfCanaryScript();
  const canaryTests = trackedTestFiles().filter((path) => readFileSync(resolve(repoRoot, path), "utf8").includes(CANARY_MODULE));

  it("finds the canary tests to check", () => {
    expect(canaryTests.length).toBeGreaterThan(0);
  });

  it.each(canaryTests.map((path) => [path] as const))("%s has the gate's path filter in its path", (path) => {
    expect(path, `npm run test:canary selects by "${selector}", so a test importing ${CANARY_MODULE} must carry it in its path`).toContain(
      selector,
    );
  });
});
