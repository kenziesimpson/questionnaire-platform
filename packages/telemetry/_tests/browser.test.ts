import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as browser from "../src/browser.js";

const SOURCE_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

const ENTRY = resolve(SOURCE_ROOT, "browser.ts");

const ALLOWED_PACKAGES = ["@opentelemetry/api", "@opentelemetry/sdk-trace-web", "@qp/shared"];

const NODE_ONLY_SOURCES = ["node.ts", "testing.ts", "leak-test.ts", "pipeline.ts", "exporters.ts"];

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*"([^"]+)"/g;

interface Graph {
  readonly files: Set<string>;
  readonly packages: Set<string>;
}

function specifiersOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(IMPORT_SPECIFIER)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

function graphFrom(entry: string): Graph {
  const graph: Graph = { files: new Set(), packages: new Set() };
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (graph.files.has(file)) continue;
    graph.files.add(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      else graph.packages.add(specifier);
    }
  }
  return graph;
}

describe("the browser entry point", () => {
  const graph = graphFrom(ENTRY);

  it("reads the whole import graph, including the core it builds on", () => {
    const names = [...graph.files].map((file) => file.slice(SOURCE_ROOT.length));

    expect(names).toEqual(
      expect.arrayContaining([
        "browser.ts",
        "browser/queue.ts",
        "browser/tracing.ts",
        "browser/wire.ts",
        "fields.ts",
        "scrub.ts",
        "logger.ts",
        "trace-context.ts",
        "wire-contract.ts",
      ]),
    );
  });

  it("imports only the browser-safe packages", () => {
    expect([...graph.packages].sort()).toEqual([...ALLOWED_PACKAGES].sort());
  });

  it("imports no Node built-in, with or without the node: prefix", () => {
    const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

    expect([...graph.packages].filter((name) => builtins.has(name))).toEqual([]);
  });

  it.each(NODE_ONLY_SOURCES)("never reaches %s", (name) => {
    expect(graph.files.has(resolve(SOURCE_ROOT, name))).toBe(false);
  });

  it("exports the browser SDK and nothing from the Node side", () => {
    expect(Object.keys(browser).sort()).toEqual([
      "BEACON_BODY_BUDGET_BYTES",
      "CLIENT_LOG_LEVELS",
      "afterFirstPaint",
      "captureError",
      "createEventQueue",
      "flushOnPageHide",
      "injectTraceHeaders",
      "installErrorCapture",
      "routeLogsToQueue",
      "startBrowserTelemetry",
      "startBrowserTracing",
      "stopBrowserTracing",
      "toBeaconBlob",
      "toEnvelopes",
      "toFetchInit",
      "toWireEvent",
    ]);
  });
});
