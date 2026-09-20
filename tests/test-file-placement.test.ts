import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const ALLOWED_INTEGRATION_TESTS = [
  "apps/admin/_tests/authoring-flow.test.tsx",
  "apps/admin/_tests/screens/draft-editor/predicate-editor.test.tsx",
  "apps/admin/_tests/screens/response-detail/leak-test.response-detail-render.test.tsx",
  "apps/admin/_tests/screens/response-detail/leak-test.response-detail.test.tsx",
  "apps/backend/_tests/db/grants.test.ts",
  "apps/backend/_tests/db/hand-edits.test.ts",
  "apps/backend/_tests/db/immutability.test.ts",
  "apps/backend/_tests/db/migration-lock.test.ts",
  "apps/backend/_tests/db/monitor.test.ts",
  "apps/backend/_tests/db/other-option.test.ts",
  "apps/backend/_tests/db/postgres-config.test.ts",
  "apps/backend/_tests/db/postgres-log-routes.test.ts",
  "apps/backend/_tests/db/postgres-log.test.ts",
  "apps/backend/_tests/db/promote-draft.test.ts",
  "apps/backend/_tests/db/published-only-guard.test.ts",
  "apps/backend/_tests/db/response-shape.test.ts",
  "apps/backend/_tests/db/roles.test.ts",
  "apps/backend/_tests/db/schema-drift.test.ts",
  "apps/backend/_tests/db/server.test.ts",
  "apps/backend/_tests/leak-test/leak-test-mutation.test.ts",
  "apps/backend/_tests/leak-test/leak-test.test.ts",
  "apps/backend/_tests/modules/definition/definition-api.test.ts",
  "apps/backend/_tests/modules/execution/boundary.test.ts",
  "apps/backend/_tests/modules/execution/published-definitions.test.ts",
  "apps/backend/_tests/modules/execution/sessions.test.ts",
  "apps/backend/_tests/modules/execution/submit.test.ts",
  "apps/backend/_tests/modules/execution/version-pinning.test.ts",
  "apps/backend/_tests/telemetry-shapes.test.ts",
  "apps/backend/_tests/trace-continuity.test.ts",
  "apps/respondent/_tests/telemetry/leak-test.respondent.test.tsx",
  "packages/shared/_tests/api/api.test.ts",
  "packages/shared/_tests/domain/schemas.test.ts",
  "packages/telemetry/_tests/browser/leak-test.browser.test.ts",
  "packages/telemetry/_tests/browser/wire-contract.leak-test.test.ts",
  "packages/telemetry/_tests/collector-allowlist.test.ts",
  "packages/ui/_tests/questionnaire/accessibility.test.tsx",
];

function trackedFiles(...patterns: string[]): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", ...patterns], { cwd: repoRoot });
  return output
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0)
    .sort();
}

function candidateSourcePaths(testPath: string): string[] {
  const marker = "/_tests/";
  const start = testPath.indexOf(marker);
  const workspace = testPath.slice(0, start);
  const rest = testPath.slice(start + marker.length);
  for (const testExt of [".test.tsx", ".test.ts"]) {
    if (rest.endsWith(testExt)) {
      const base = rest.slice(0, -testExt.length);
      return [`${workspace}/src/${base}.ts`, `${workspace}/src/${base}.tsx`];
    }
  }
  return [];
}

function hasMatchingSource(testPath: string): boolean {
  return candidateSourcePaths(testPath).some((candidate) => existsSync(resolve(repoRoot, candidate)));
}

describe("R3 — test files sit only under _tests/, mirroring src/", () => {
  it("no *.test.* file sits under a src/ directory", () => {
    const stray = trackedFiles("**/src/**/*.test.*", "**/src/*.test.*");
    expect(stray).toEqual([]);
  });

  const testFiles = trackedFiles("**/_tests/*.test.*");

  it("finds the tracked _tests files to check", () => {
    expect(testFiles.length).toBeGreaterThan(0);
    expect(testFiles).toContain("apps/respondent/_tests/app.test.tsx");
  });

  const allowlisted = new Set(ALLOWED_INTEGRATION_TESTS);

  it.each(testFiles.filter((path) => !allowlisted.has(path)))("%s mirrors a src/**/*.ts(x) file", (testPath) => {
    expect(
      hasMatchingSource(testPath),
      `${testPath} has no matching source file among ${candidateSourcePaths(testPath).join(", ")}; add it to the allowlist if it is an integration or support test`,
    ).toBe(true);
  });

  it.each(ALLOWED_INTEGRATION_TESTS)("%s is a tracked test that earns its allowlist entry", (allowedPath) => {
    expect(testFiles, `${allowedPath} is not a tracked _tests/**/*.test.* file; drop it from the allowlist`).toContain(allowedPath);
    expect(hasMatchingSource(allowedPath), `${allowedPath} now has a matching source file; drop it from the allowlist`).toBe(false);
  });
});
