import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const ROOT_PRESET_NAMES = ["tsconfig.base.json", "tsconfig.node.json", "tsconfig.react.json"];

const rootPresetPaths = new Set(ROOT_PRESET_NAMES.map((name) => resolve(repoRoot, name)));

function trackedTsconfigs(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", "tsconfig*.json", "**/tsconfig*.json"], {
    cwd: repoRoot,
  });
  return output
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0)
    .sort();
}

function resolveExtendsTarget(fromFile: string, specifier: string): string {
  const resolved = resolve(dirname(fromFile), specifier);
  return resolved.endsWith(".json") ? resolved : `${resolved}.json`;
}

function parseConfig(path: string): Record<string, unknown> {
  const { config, error } = ts.readConfigFile(path, ts.sys.readFile);
  if (error) {
    throw new Error(`Failed to parse ${path}: ${JSON.stringify(error.messageText)}`);
  }
  return config as Record<string, unknown>;
}

function extendsChain(path: string): string[] {
  const visited: string[] = [];
  const queue: string[] = [path];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);

    const config = parseConfig(current);
    const rawExtends = config.extends;
    const specifiers = typeof rawExtends === "string" ? [rawExtends] : Array.isArray(rawExtends) ? rawExtends : [];

    for (const specifier of specifiers) {
      if (typeof specifier !== "string" || specifier.startsWith("@") || !specifier.startsWith(".")) {
        continue;
      }
      const target = resolveExtendsTarget(current, specifier);
      visited.push(target);
      queue.push(target);
    }
  }

  return visited;
}

function isSolutionFile(path: string): boolean {
  const config = parseConfig(path);
  return Array.isArray(config.files) && config.files.length === 0 && Array.isArray(config.references) && config.references.length > 0;
}

describe("R1 — every tsconfig*.json extends a root preset", () => {
  const configs = trackedTsconfigs();

  it("finds the tracked tsconfig files to check", () => {
    expect(configs).toContain("tsconfig.base.json");
    expect(configs).toContain("apps/backend/tsconfig.json");
  });

  const nonPresetConfigs = configs.filter((path) => !ROOT_PRESET_NAMES.includes(path));

  it.each(nonPresetConfigs.filter((path) => !isSolutionFile(resolve(repoRoot, path))))(
    "%s extends tsconfig.base.json, tsconfig.node.json or tsconfig.react.json",
    (relativePath) => {
      const absolutePath = resolve(repoRoot, relativePath);
      const chain = extendsChain(absolutePath);
      const reachesRootPreset = chain.some((target) => rootPresetPaths.has(target));

      expect(reachesRootPreset, `${relativePath} does not extend a root tsconfig preset (chain: ${chain.join(" -> ") || "none"})`).toBe(
        true,
      );
    },
  );

  it("every tsconfig*.json is either checked above or is a project-reference solution file", () => {
    const uncheckedSolutionFiles = nonPresetConfigs.filter((path) => isSolutionFile(resolve(repoRoot, path)));
    for (const path of uncheckedSolutionFiles) {
      const config = parseConfig(resolve(repoRoot, path));
      const references = config.references as ReadonlyArray<{ path: string }>;
      for (const reference of references) {
        const referencedPath = resolveExtendsTarget(resolve(repoRoot, path), reference.path);
        expect(configs, `${path} references ${reference.path}, which is not a tracked tsconfig*.json`).toContain(
          referencedPath.slice(repoRoot.length),
        );
      }
    }
  });

  it("tsconfig.node.json and tsconfig.react.json extend tsconfig.base.json", () => {
    for (const name of ["tsconfig.node.json", "tsconfig.react.json"]) {
      const chain = extendsChain(resolve(repoRoot, name));
      expect(chain, `${name} does not extend tsconfig.base.json`).toContain(resolve(repoRoot, "tsconfig.base.json"));
    }
  });
});
