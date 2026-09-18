import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const WORKSPACE_DIRS = [
  "packages/shared",
  "packages/telemetry",
  "packages/ui",
  "apps/admin",
  "apps/backend",
  "apps/respondent",
  "e2e",
];

const JS_EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "mjs", "cjs"];

const GROUND_RULE_UNUSED_DEPENDENCIES: Record<string, readonly string[]> = {
  "apps/backend": ["pino", "pino-pretty", "@fastify/otel"],
};

function trackedFiles(dir: string, extensions: readonly string[]): string[] {
  const patterns = extensions.map((extension) => `${dir}/*.${extension}`);
  const output = execFileSync("git", ["ls-files", "-z", "--", ...patterns], { cwd: repoRoot });
  return output
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function jsImportSpecifiers(filePath: string): string[] {
  const text = readFileSync(resolve(repoRoot, filePath), "utf8");
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const firstArgument = node.arguments[0];
      if ((isDynamicImport || isRequire) && firstArgument && ts.isStringLiteral(firstArgument)) {
        specifiers.push(firstArgument.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function cssImportSpecifiers(filePath: string): string[] {
  const text = readFileSync(resolve(repoRoot, filePath), "utf8");
  return [...text.matchAll(/@import\s+["']([^"']+)["']/g)].map((match) => match[1]);
}

function packageNameOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

function isExternalSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:");
}

function importedPackagesOf(dir: string): Set<string> {
  const imported = new Set<string>();
  for (const file of trackedFiles(dir, JS_EXTENSIONS)) {
    for (const specifier of jsImportSpecifiers(file)) {
      if (isExternalSpecifier(specifier)) {
        imported.add(packageNameOf(specifier));
      }
    }
  }
  for (const file of trackedFiles(dir, ["css"])) {
    for (const specifier of cssImportSpecifiers(file)) {
      if (isExternalSpecifier(specifier)) {
        imported.add(packageNameOf(specifier));
      }
    }
  }
  return imported;
}

function readPackageJson(dir: string): {
  name: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
} {
  const raw = JSON.parse(readFileSync(resolve(repoRoot, dir, "package.json"), "utf8"));
  return {
    name: raw.name,
    dependencies: raw.dependencies ?? {},
    devDependencies: raw.devDependencies ?? {},
    peerDependencies: raw.peerDependencies ?? {},
  };
}

describe("R5 — workspace dependencies match what the workspace imports", () => {
  it("finds the workspaces to check", () => {
    for (const dir of WORKSPACE_DIRS) {
      expect(trackedFiles(dir, JS_EXTENSIONS).length, `${dir} has no tracked source files`).toBeGreaterThan(0);
    }
  });

  describe.each(WORKSPACE_DIRS)("%s", (dir) => {
    const pkg = readPackageJson(dir);
    const imported = importedPackagesOf(dir);
    imported.delete(pkg.name);

    const declared = new Set([
      ...Object.keys(pkg.dependencies),
      ...Object.keys(pkg.devDependencies),
      ...Object.keys(pkg.peerDependencies),
    ]);

    it.each([...imported])("%s is declared as a dependency, devDependency or peerDependency", (name) => {
      expect(declared.has(name), `${dir} imports "${name}" without declaring it in package.json`).toBe(true);
    });

    const exemptFromUnusedCheck = new Set(GROUND_RULE_UNUSED_DEPENDENCIES[dir] ?? []);

    it.each(Object.keys(pkg.dependencies).filter((name) => !exemptFromUnusedCheck.has(name)))(
      "%s is imported somewhere in the workspace",
      (name) => {
        expect(imported.has(name), `${dir} declares "${name}" as a dependency but nothing imports it`).toBe(true);
      },
    );

    it.each([...exemptFromUnusedCheck])(
      "%s stays an unused dependency only because ground rule §1 keeps it as a telemetry seam",
      (name) => {
        expect(Object.keys(pkg.dependencies), `${dir} no longer declares "${name}"; drop it from the exemption list`).toContain(name);
        expect(imported.has(name), `${dir} now imports "${name}"; drop it from the exemption list`).toBe(false);
      },
    );
  });
});
