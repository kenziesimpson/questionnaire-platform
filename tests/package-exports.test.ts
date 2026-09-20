import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function trackedPackageJsonPaths(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", "package.json", "*/package.json"], {
    cwd: repoRoot,
  });
  return output
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0)
    .sort();
}

interface ExportsCase {
  packagePath: string;
  subpath: string;
  target: string;
}

function exportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(exportTargets);
  }
  return [];
}

function packageCasesFor(packagePath: string): ExportsCase[] {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, packagePath), "utf8")) as {
    exports?: Record<string, unknown>;
    main?: unknown;
    types?: unknown;
  };
  const exportsCases = pkg.exports === undefined
    ? []
    : Object.entries(pkg.exports).flatMap(([subpath, value]) =>
        exportTargets(value).map((target) => ({ packagePath, subpath, target })),
      );
  const mainAndTypesCases = (["main", "types"] as const)
    .filter((field) => typeof pkg[field] === "string")
    .map((field) => ({ packagePath, subpath: field, target: pkg[field] as string }));
  return [...exportsCases, ...mainAndTypesCases];
}

function distToSourceCandidates(distFile: string): string[] {
  const sourceFile = distFile.replace("/dist/", "/src/");
  const knownDistExtensions = [".d.ts", ".js"];
  const distExtension = knownDistExtensions.find((extension) => sourceFile.endsWith(extension));
  if (distExtension === undefined) return [sourceFile];
  const withoutExtension = sourceFile.slice(0, -distExtension.length);
  return [`${withoutExtension}.ts`, `${withoutExtension}.tsx`];
}

function wildcardMatches(packageDir: string, target: string): string[] {
  const [prefix = "", suffix] = target.split("*");
  if (suffix === undefined) throw new Error(`Expected exactly one "*" in wildcard target "${target}"`);
  if (!prefix.endsWith("/")) {
    throw new Error(`Expected the wildcard target "${target}" to split on a directory, like ".../*.ts"`);
  }
  const directory = resolve(packageDir, prefix);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(suffix));
}

describe("R2 — every target in a package exports map exists", () => {
  const packagePaths = trackedPackageJsonPaths();
  const cases = packagePaths.flatMap((packagePath) => packageCasesFor(packagePath));

  it("finds package.json files with an exports map to check", () => {
    expect(packagePaths).toContain("packages/ui/package.json");
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("$packagePath: \"$subpath\" -> \"$target\" resolves to a real file", ({ packagePath, target }) => {
    const packageDir = dirname(resolve(repoRoot, packagePath));

    if (target.includes("*")) {
      const matches = wildcardMatches(packageDir, target);
      expect(matches.length, `no file under ${packageDir} matches the pattern "${target}"`).toBeGreaterThan(0);
      return;
    }

    const direct = resolve(packageDir, target);
    if (existsSync(direct)) return;

    if (target.includes("/dist/")) {
      const candidates = distToSourceCandidates(target).map((candidate) => resolve(packageDir, candidate));
      const buildableFromSource = candidates.some((candidate) => existsSync(candidate));
      expect(
        buildableFromSource,
        `"${target}" is not built yet and none of its source candidates exist: ${candidates.join(", ")}`,
      ).toBe(true);
      return;
    }

    expect(existsSync(direct), `"${target}" does not exist at ${direct}`).toBe(true);
  });
});
