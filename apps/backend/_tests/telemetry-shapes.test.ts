import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { definitionApi, executionApi, reportingApi } from "@qp/shared";
import { FIELDS } from "@qp/telemetry";
import { describe, expect, it } from "vitest";
import { QUESTION_VERSION_PRIMARY_KEY } from "../src/db/errors.js";

const MIGRATIONS = fileURLToPath(new URL("../drizzle/", import.meta.url));

const CONSTRAINT_DECLARATION = /\bCONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;

const HEALTH_ROUTES = ["/health", "/health/live", "/health/ready"];

async function constraintNames(): Promise<string[]> {
  const files = (await readdir(MIGRATIONS)).filter((file) => file.endsWith(".sql"));
  const names = new Set<string>();
  for (const file of files) {
    const migration = await readFile(`${MIGRATIONS}${file}`, "utf8");
    for (const declaration of migration.matchAll(CONSTRAINT_DECLARATION)) {
      if (declaration[1] !== undefined) names.add(declaration[1]);
    }
  }
  return [...names];
}

describe("the route templates the backend registers", () => {
  it.each([
    ["definition", definitionApi.DEFINITION_PREFIX, definitionApi.definitionRoutes],
    ["execution", executionApi.EXECUTION_PREFIX, executionApi.executionRoutes],
    ["reporting", reportingApi.REPORTING_PREFIX, reportingApi.reportingRoutes],
  ])("are all accepted by the route field (%s)", (_module, prefix, routes) => {
    expect(routes.length).toBeGreaterThan(0);
    const rejected = routes.map((route) => `${prefix}${route.url}`).filter((url) => !FIELDS.route.accepts(url));

    expect(rejected).toEqual([]);
  });

  it("include the health probes", () => {
    expect(HEALTH_ROUTES.filter((url) => !FIELDS.route.accepts(url))).toEqual([]);
  });
});

describe("the constraint names the migrations declare", () => {
  it("are all accepted by the constraint field", async () => {
    const names = [...(await constraintNames()), QUESTION_VERSION_PRIMARY_KEY];

    expect(names.length).toBeGreaterThan(30);
    expect(names.filter((name) => !FIELDS.constraint.accepts(name))).toEqual([]);
  });
});
