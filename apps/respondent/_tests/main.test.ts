import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TELEMETRY_ROOT = resolve(APP_ROOT, "../../packages/telemetry/src/");

const ENTRY = resolve(APP_ROOT, "src/main.tsx");

const TRACING_MODULE = resolve(APP_ROOT, "src/telemetry/tracing.ts");

const STATIC_SPECIFIER = /(?:\bfrom|\bimport)\s*"([^"]+)"/g;

const DYNAMIC_SPECIFIER = /\bimport\s*\(\s*"([^"]+)"\s*\)/g;

const TELEMETRY_ENTRIES: Readonly<Record<string, string>> = {
  "@qp/telemetry": "index.ts",
  "@qp/telemetry/browser": "browser.ts",
  "@qp/telemetry/browser-tracing": "browser-tracing.ts",
};

interface Graph {
  readonly files: Set<string>;
  readonly packages: Set<string>;
}

function specifiersIn(file: string, expression: RegExp): string[] {
  return [...readFileSync(file, "utf8").matchAll(expression)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

function resolved(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ""));
  return [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")].find((candidate) => existsSync(candidate));
}

function staticGraphFrom(entry: string): Graph {
  const graph: Graph = { files: new Set(), packages: new Set() };
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (graph.files.has(file)) continue;
    graph.files.add(file);
    for (const specifier of specifiersIn(file, STATIC_SPECIFIER)) {
      const telemetryEntry = TELEMETRY_ENTRIES[specifier];
      if (telemetryEntry !== undefined) {
        graph.packages.add(specifier);
        pending.push(resolve(TELEMETRY_ROOT, telemetryEntry));
      } else if (specifier.startsWith(".")) {
        const next = resolved(file, specifier);
        if (next !== undefined) pending.push(next);
      } else {
        graph.packages.add(specifier);
      }
    }
  }
  return graph;
}

describe("the respondent's import graph", () => {
  const graph = staticGraphFrom(ENTRY);

  it("reads the whole static graph: the app, its telemetry wiring and the SDK it builds on", () => {
    const names = [...graph.files].map((file) => relative(file.startsWith(TELEMETRY_ROOT) ? TELEMETRY_ROOT : APP_ROOT, file));

    expect(names).toEqual(
      expect.arrayContaining([
        "src/main.tsx",
        "src/app.tsx",
        "src/api/request.ts",
        "src/telemetry/start.ts",
        "src/telemetry/error-boundary.tsx",
        "browser.ts",
        "browser/queue.ts",
        "browser/trace-headers.ts",
        "index.ts",
        "spans.ts",
      ]),
    );
  });

  it("never reaches the web tracer provider or the tracing entry point, so a build without tracing ships neither", () => {
    expect(graph.packages).not.toContain("@opentelemetry/sdk-trace-web");
    expect(graph.packages).not.toContain("@qp/telemetry/browser-tracing");
    expect(graph.files.has(resolve(TELEMETRY_ROOT, "browser-tracing.ts"))).toBe(false);
    expect(graph.files.has(resolve(TELEMETRY_ROOT, "browser/tracing.ts"))).toBe(false);
    expect(graph.files.has(TRACING_MODULE)).toBe(true);
  });

  it("reaches the tracing entry point only through the dynamic import in src/telemetry/tracing.ts", () => {
    const dynamic = [...graph.files].filter((file) => specifiersIn(file, DYNAMIC_SPECIFIER).includes("@qp/telemetry/browser-tracing"));

    expect(dynamic).toEqual([TRACING_MODULE]);
  });

  it("reaches no Node-only telemetry module", () => {
    for (const nodeOnly of ["node.ts", "testing.ts", "leak-test.ts", "pipeline.ts", "exporters.ts", "log-records.ts"]) {
      expect(graph.files.has(resolve(TELEMETRY_ROOT, nodeOnly))).toBe(false);
    }
    expect([...graph.packages].filter((name) => name === "pino" || name.startsWith("@opentelemetry/sdk-node"))).toEqual([]);
  });
});
