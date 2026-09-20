import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as browser from "../src/browser.js";
import * as browserTracing from "../src/browser-tracing.js";

const SOURCE_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

const ENTRY = resolve(SOURCE_ROOT, "browser.ts");

const TRACING_ENTRY = resolve(SOURCE_ROOT, "browser-tracing.ts");

const ALLOWED_PACKAGES = ["@opentelemetry/api", "@qp/shared"];

const TRACING_PACKAGES = ["@opentelemetry/api", "@opentelemetry/sdk-trace-web"];

const NODE_ONLY_SOURCES = ["node.ts", "testing.ts", "leak-test.ts", "pipeline.ts", "exporters.ts", "log-records.ts"];

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
        "browser/trace-headers.ts",
        "browser/transport.ts",
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

  it("never reaches the web tracer provider, so an app that does not start tracing does not ship it", () => {
    expect(graph.packages.has("@opentelemetry/sdk-trace-web")).toBe(false);
    expect(graph.files.has(resolve(SOURCE_ROOT, "browser/tracing.ts"))).toBe(false);
    expect(graph.files.has(TRACING_ENTRY)).toBe(false);
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
      "createTransport",
      "flushOnPageHide",
      "injectTraceHeaders",
      "installErrorCapture",
      "routeLogsToQueue",
      "startBrowserTelemetry",
      "toBeaconBlob",
      "toEnvelopes",
      "toFetchInit",
      "toWireEvent",
    ]);
  });
});

describe("the browser tracing entry point", () => {
  const graph = graphFrom(TRACING_ENTRY);

  it("imports the web tracer provider and nothing beyond the API, and no Node built-in", () => {
    const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

    expect([...graph.packages].sort()).toEqual([...TRACING_PACKAGES].sort());
    expect([...graph.packages].filter((name) => builtins.has(name))).toEqual([]);
  });

  it.each(NODE_ONLY_SOURCES)("never reaches %s", (name) => {
    expect(graph.files.has(resolve(SOURCE_ROOT, name))).toBe(false);
  });

  it("exports start and stop and nothing else", () => {
    expect(Object.keys(browserTracing).sort()).toEqual(["startBrowserTracing", "stopBrowserTracing"]);
  });
});
