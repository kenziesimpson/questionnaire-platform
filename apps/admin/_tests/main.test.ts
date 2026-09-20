import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/main.tsx"), "utf8");

const BOUNDARY_ELEMENTS = /<ErrorBoundary\b(.*\})>\s*$/gm;

describe("the admin's entry point", () => {
  it("gives the one shared ErrorBoundary its fallback and reportRenderError as onError, and no other reporter", () => {
    const boundaries = [...MAIN.matchAll(BOUNDARY_ELEMENTS)].map((match) => match[1]?.trim());

    expect(boundaries).toEqual(["fallback={<ErrorFallback />} onError={reportRenderError}"]);
  });

  it("takes the boundary from @qp/ui/error-boundary and the reporter from its own telemetry start module", () => {
    expect(MAIN).toContain('import { ErrorBoundary } from "@qp/ui/error-boundary";');
    expect(MAIN).toMatch(/import \{[^}]*\breportRenderError\b[^}]*\} from "\.\/telemetry\/start";/);
  });
});
