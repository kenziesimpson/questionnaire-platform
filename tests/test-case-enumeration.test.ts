import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const docPath = resolve(repoRoot, "docs/8-testing.md");

const WORKSPACE_TOKENS = ["apps/backend", "apps/admin", "apps/respondent", "packages/shared", "packages/telemetry", "packages/ui"];
const ROOT_RELATIVE_PREFIXES = ["tests/", "e2e/", ...WORKSPACE_TOKENS.map((workspace) => `${workspace}/`)];

interface CitedPath {
  readonly cell: string;
  readonly resolved: string;
}

function workspaceOfHeading(heading: string): string | undefined {
  if (heading.includes("`tests/`") || heading.includes("Repo configuration") || heading.includes("End-to-end")) return "";
  for (const workspace of WORKSPACE_TOKENS) {
    if (
      heading.includes(`\`${workspace}\``) ||
      heading.includes(`\`${workspace},`) ||
      heading.includes(`\`${workspace}:`) ||
      heading.includes(`\`${workspace} `)
    ) {
      return workspace;
    }
  }
  return undefined;
}

function resolvePath(cell: string, workspace: string): string {
  if (ROOT_RELATIVE_PREFIXES.some((prefix) => cell.startsWith(prefix))) return cell;
  const rest = cell.startsWith("_tests/") ? cell.slice("_tests/".length) : cell;
  return workspace === "" ? `_tests/${rest}` : `${workspace}/_tests/${rest}`;
}

function citedPaths(): CitedPath[] {
  const doc = readFileSync(docPath, "utf8");
  const start = doc.indexOf("## 7. Test case enumeration");
  const end = doc.indexOf("## 8. Alternatives considered");
  const section = doc.slice(start, end);

  const cited: CitedPath[] = [];
  let workspace: string | undefined;

  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("**")) {
      workspace = workspaceOfHeading(trimmed) ?? workspace;
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = line.split("|");
    const fileCell = cells[2];
    if (fileCell === undefined || fileCell.trim() === "File" || fileCell.trim() === "---") continue;
    for (const match of fileCell.matchAll(/`([^`]+)`/g)) {
      const cell = match[1]!;
      if (!cell.includes("/") || !(cell.endsWith(".ts") || cell.endsWith(".tsx"))) continue;
      if (workspace === undefined) throw new Error(`"${cell}" is cited before any workspace heading in §7`);
      cited.push({ cell, resolved: resolvePath(cell, workspace) });
    }
  }
  return cited;
}

describe("R4 — every test path cited in docs/8-testing.md §7 exists", () => {
  const cited = citedPaths();

  it("finds cases to check", () => {
    expect(cited.length).toBeGreaterThan(400);
  });

  it.each(cited.map(({ resolved, cell }) => [resolved, cell] as const))("%s exists (cited as `%s`)", (resolved) => {
    expect(existsSync(resolve(repoRoot, resolved)), `${resolved} does not exist`).toBe(true);
  });
});
