import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const DEFINITION = "apps/backend/src/modules/definition/routes/publish.ts";
const EXECUTION = "apps/backend/src/modules/execution/submit.ts";
const EXAMPLE_BACKEND = "apps/backend/src/http/example.ts";

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

const RULE = "local/no-cast-into-telemetry-text";

async function castMessages(filePath: string, code: string) {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === RULE);
}

describe("telemetry text: a cast into a log message, logger module or span name is an error", () => {
  const PREAMBLE = `import { logger, withSpan, type LiteralMessage, type SpanName } from "@qp/telemetry";\nconst log = logger("http");\ndeclare const value: string;\n`;

  it.each([
    ["a cast to a string literal in a log message", `log.info(value as "message");`],
    ["a cast to a union of literals", `log.warn(value as "a" | "b");`],
    ["a cast to never", `log.error(value as never, { status: 500 });`],
    ["a cast to any", `log.debug(value as any);`],
    ["an angle-bracket cast", `log.info(<"message">value);`],
    ["a cast to LiteralMessage", `log.info(value as LiteralMessage<"x">);`],
    ["a cast on a call chained straight off logger()", `logger("http").info(value as "message");`],
    ["a cast in the logger module name", `logger(value as "http");`],
    ["a cast to SpanName", `void withSpan(value as SpanName, {}, async () => 1);`],
    ["a cast to a span name literal", `void withSpan(value as "session.submit", {}, async () => 1);`],
  ])("reports %s", async (_, statement) => {
    const messages = await castMessages(EXAMPLE_BACKEND, `${PREAMBLE}${statement}`);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.severity).toBe(2);
  });

  it("follows a renamed import of logger and withSpan", async () => {
    const code = `import { logger as makeLogger, withSpan as span } from "@qp/telemetry";\ndeclare const value: string;\nconst log = makeLogger("http");\nlog.info(value as "x");\nvoid span(value as "x", {}, async () => 1);`;

    expect(await castMessages(EXAMPLE_BACKEND, code)).toHaveLength(2);
  });

  it.each([
    ["a literal message", `log.info("session submitted", { sessionId: value });`],
    ["a const assertion", `log.info("session submitted" as const);`],
    ["a cast in the context argument", `log.info("session submitted", { itemId: value as string });`],
    ["a plain module name", `logger("http");`],
    ["a literal span name", `void withSpan("session.submit", {}, async () => 1);`],
    ["a cast into another object's error method", `declare const toast: { error(text: string): void };\ntoast.error(value as any);`],
    ["a cast into console.error", `console.error(value as "x");`],
  ])("allows %s", async (_, statement) => {
    expect(await castMessages(EXAMPLE_BACKEND, `${PREAMBLE}${statement}`)).toEqual([]);
  });

  it("ignores a logger and a withSpan that do not come from @qp/telemetry", async () => {
    const code = `import { logger, withSpan } from "./somewhere-else.js";\nconst log = logger("x");\ndeclare const value: string;\nlog.info(value as "x");\nvoid withSpan(value as "x");`;

    expect(await castMessages(EXAMPLE_BACKEND, code)).toEqual([]);
  });

  it.each([
    ["a cast hoisted into a variable", `const message = value as "x";\nlog.info(message);`],
    ["a cast through a type alias", `type Message = "x";\nlog.info(value as Message);`],
    ["a computed method call", `log["info"](value as "x");`],
    ["a logger held under another name", `const alias = log;\nalias.info(value as "x");`],
    ["a wrapper around the logger", `const wrapper = { info: (text: "x") => log.info(text) };\nwrapper.info(value as "x");`],
    ["a logger reached through a namespace import", `import * as telemetry from "@qp/telemetry";\ntelemetry.logger("http").info(value as "x");`],
    ["a logger created in another file", `declare const shared: ReturnType<typeof logger>;\nshared.info(value as "x");`],
    ["a cast in the second argument of a call", `log.info("x", value as "y" as never);`],
  ])("does not see %s, a known false negative", async (_, statement) => {
    expect(await castMessages(EXAMPLE_BACKEND, `${PREAMBLE}${statement}`)).toEqual([]);
  });

  it("applies in every workspace, including tests", async () => {
    const code = `${PREAMBLE}log.info(value as "message");`;

    expect(await castMessages("packages/telemetry/src/example.ts", code)).toHaveLength(1);
    expect(await castMessages("apps/backend/_tests/example.test.ts", code)).toHaveLength(1);
    expect(await castMessages("apps/admin/src/example.tsx", code)).toHaveLength(1);
  });

  it("accepts a disable comment carrying a reason, and it counts as used", async () => {
    const code = `${PREAMBLE}// eslint-disable-next-line ${RULE} -- the negative control\nlog.info(value as "message");`;

    expect(await lintAs(EXAMPLE_BACKEND, code)).toEqual([]);
  });

  it("fails an unused disable comment, so the rule cannot be disabled by habit", async () => {
    const code = `${PREAMBLE}// eslint-disable-next-line ${RULE} -- nothing to disable\nlog.info("message");`;

    const messages = await lintAs(EXAMPLE_BACKEND, code);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain("Unused eslint-disable directive");
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
