import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const DEFINITION = "apps/backend/src/modules/definition/routes/publish.ts";
const EXECUTION = "apps/backend/src/modules/execution/submit.ts";

describe("telemetry boundary: only packages/telemetry imports pino or OpenTelemetry", () => {
  it.each([
    ["pino", `import pino from "pino";`],
    ["a pino subpath", `import { destination } from "pino/file";`],
    ["a pino plugin", `import pretty from "pino-pretty";`],
    ["the OTel API", `import { trace } from "@opentelemetry/api";`],
    ["a type-only OTel import", `import type { Span } from "@opentelemetry/api";`],
    ["an OTel SDK subpath", `import { NodeSDK } from "@opentelemetry/sdk-node";`],
    ["the Fastify OTel instrumentation", `import { FastifyOtelInstrumentation } from "@fastify/otel";`],
  ])("rejects %s outside the telemetry package", async (_, code) => {
    expect(await restrictedImports("apps/backend/src/server.ts", code)).toHaveLength(1);
    expect(await restrictedImports("packages/shared/src/engine.ts", code)).toHaveLength(1);
  });

  it("still rejects them inside a backend module, which inherits the base patterns", async () => {
    expect(await restrictedImports(DEFINITION, `import pino from "pino";`)).toHaveLength(1);
    expect(await restrictedImports(EXECUTION, `import { trace } from "@opentelemetry/api";`)).toHaveLength(1);
  });

  it("allows them inside packages/telemetry", async () => {
    expect(await restrictedImports("packages/telemetry/src/logger.ts", `import pino from "pino";`)).toEqual([]);
    expect(await restrictedImports("packages/telemetry/src/pipeline.ts", `import { FastifyOtelInstrumentation } from "@fastify/otel";`)).toEqual([]);
    expect(await restrictedImports("packages/telemetry/src/node.ts", `import { NodeSDK } from "@opentelemetry/sdk-node";`)).toEqual([]);
  });
});

describe("module boundary: definition and execution never import each other", () => {
  it.each([
    ["a sibling relative import", `import { x } from "../execution/repository.js";`],
    ["a deep relative import", `import { x } from "../../execution/repository.js";`],
    ["a path through modules/", `import { x } from "../../modules/execution/index.js";`],
    ["a type-only import", `import type { X } from "../execution/types.js";`],
    ["a sibling import through a ./ segment", `import { x } from ".././execution/repository.js";`],
    ["a path through modules/ with a ./ segment", `import { x } from "../../modules/./execution/index.js";`],
    ["a relative import with a doubled slash", `import { x } from "..//execution/repository.js";`],
  ])("definition rejects %s of execution", async (_, code) => {
    expect(await restrictedImports(DEFINITION, code)).toHaveLength(1);
  });

  it("execution rejects an import of definition", async () => {
    expect(await restrictedImports(EXECUTION, `import { x } from "../definition/repository.js";`)).toHaveLength(1);
  });

  it("allows @qp/shared and imports within the module itself", async () => {
    const code = `import { PublishedDefinition } from "@qp/shared";\nimport { lock } from "../repository.js";`;
    expect(await restrictedImports(DEFINITION, code)).toEqual([]);
    expect(await restrictedImports(EXECUTION, code)).toEqual([]);
  });

  it("does not trip on unrelated paths that merely contain the word", async () => {
    expect(await restrictedImports(DEFINITION, `import { x } from "./execution-order.js";`)).toEqual([]);
    expect(await restrictedImports(DEFINITION, `import { x } from "./execution/local.js";`)).toEqual([]);
  });
});
