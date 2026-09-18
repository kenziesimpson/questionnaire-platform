import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedSyntax(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

const BACKEND_SRC = "apps/backend/src/modules/definition/plugin.ts";
const BACKEND_SCHEMA = "apps/backend/src/db/schema.ts";
const BACKEND_CLIENT = "apps/backend/src/db/client.ts";
const BACKEND_NOT_FOUND_BUILDER = "apps/backend/src/http/problems.ts";
const BACKEND_TESTS = "apps/backend/_tests/modules/definition/plugin.test.ts";
const BACKEND_HARNESS = "apps/backend/_tests/db/harness.ts";
const BACKEND_GLOBAL_SETUP = "apps/backend/_tests/db/global-setup.ts";
const SHARED_SRC = "packages/shared/src/api/etag.ts";
const SHARED_ROUTE_PATH_HELPER = "packages/shared/src/api/request.ts";
const SHARED_DOMAIN = "packages/shared/src/domain/answer.ts";
const SHARED_PROBLEM_PARSER = "packages/shared/src/problems.ts";
const SHARED_TESTS = "packages/shared/_tests/api/etag.test.ts";
const TELEMETRY_SRC = "packages/telemetry/src/index.ts";
const TELEMETRY_TESTS = "packages/telemetry/_tests/index.test.ts";

const ADMIN_SRC = "apps/admin/src/screens/questionnaire-list.tsx";
const ADMIN_DATES = "apps/admin/src/lib/dates.ts";
const ADMIN_TESTS = "apps/admin/_tests/screens/questionnaire-list.test.tsx";
const UI_SRC = "packages/ui/src/questionnaire/question.tsx";
const UI_TESTS = "packages/ui/_tests/questionnaire/question.test.tsx";
const RESPONDENT_SRC = "apps/respondent/src/screens/questionnaire-screen.tsx";
const RESPONDENT_TESTS = "apps/respondent/_tests/screens/questionnaire-screen.test.tsx";
const E2E_SPEC = "e2e/specs/tier-1/questionnaire.spec.ts";
const E2E_FIXTURE = "e2e/fixtures/index.ts";
const E2E_STACK = "e2e/stack/compose-stack.ts";
const E2E_STACK_GLOBAL_SETUP = "e2e/stack/global-setup.ts";

const NODE_WORKSPACE_FILES = [
  ["backend", BACKEND_SRC],
  ["backend's schema declaration", BACKEND_SCHEMA],
  ["backend's connection constructor", BACKEND_CLIENT],
  ["notFoundProblem's own file", BACKEND_NOT_FOUND_BUILDER],
  ["backend tests", BACKEND_TESTS],
  ["the backend test harness", BACKEND_HARNESS],
  ["the backend test harness's globalSetup", BACKEND_GLOBAL_SETUP],
  ["shared", SHARED_SRC],
  ["the shared route path helper", SHARED_ROUTE_PATH_HELPER],
  ["shared's own vocabulary declarations", SHARED_DOMAIN],
  ["the problem parser's own module, which is exempt from L10", SHARED_PROBLEM_PARSER],
  ["shared tests", SHARED_TESTS],
  ["telemetry", TELEMETRY_SRC],
  ["telemetry tests", TELEMETRY_TESTS],
] as const;

const BUNDLER_WORKSPACE_FILES = [
  ["admin", ADMIN_SRC],
  ["admin's own date formatter", ADMIN_DATES],
  ["admin tests", ADMIN_TESTS],
  ["packages/ui", UI_SRC],
  ["packages/ui tests", UI_TESTS],
  ["respondent", RESPONDENT_SRC],
  ["respondent tests", RESPONDENT_TESTS],
  ["e2e specs", E2E_SPEC],
  ["e2e fixtures", E2E_FIXTURE],
] as const;

describe("L13: import extension convention — Node workspaces keep .js", () => {
  it.each(NODE_WORKSPACE_FILES)("rejects a relative import missing .js in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `import { x } from "./sibling";`);

    expect(messages.some((message) => message.includes("compiled .js extension"))).toBe(true);
  });

  it.each(NODE_WORKSPACE_FILES)("allows the .js extension in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `import { x } from "./sibling.js";`);

    expect(messages.some((message) => message.includes("compiled .js extension"))).toBe(false);
  });

  it.each(NODE_WORKSPACE_FILES)("allows a parent-relative import carrying .js in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `import { x } from "../sibling.js";`);

    expect(messages.some((message) => message.includes("compiled .js extension"))).toBe(false);
  });

  it("leaves a bare package specifier alone", async () => {
    const messages = await restrictedSyntax(BACKEND_SRC, `import { x } from "@qp/shared";`);

    expect(messages.some((message) => message.includes("compiled .js extension"))).toBe(false);
  });

  it.each(NODE_WORKSPACE_FILES)("rejects a named re-export missing .js in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `export { x } from "./sibling";`);

    expect(messages.some((message) => message.includes("compiled .js extension"))).toBe(true);
  });

  it.each(NODE_WORKSPACE_FILES)("rejects a star re-export missing .js in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `export * from "./sibling";`);

    expect(messages.some((message) => message.includes("compiled .js extension"))).toBe(true);
  });

  it.each(NODE_WORKSPACE_FILES)("allows a re-export carrying .js in %s", async (_, filePath) => {
    const namedMessages = await restrictedSyntax(filePath, `export { x } from "./sibling.js";`);
    const starMessages = await restrictedSyntax(filePath, `export * from "./sibling.js";`);

    expect(namedMessages.some((message) => message.includes("compiled .js extension"))).toBe(false);
    expect(starMessages.some((message) => message.includes("compiled .js extension"))).toBe(false);
  });
});

describe("L13: import extension convention — bundler and Playwright workspaces carry no extension", () => {
  it.each(BUNDLER_WORKSPACE_FILES)("rejects a relative import carrying .ts in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `import { x } from "./sibling.ts";`);

    expect(messages.some((message) => message.includes("carry no extension"))).toBe(true);
  });

  it.each(BUNDLER_WORKSPACE_FILES)("rejects a relative import carrying .tsx in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `import { x } from "./sibling.tsx";`);

    expect(messages.some((message) => message.includes("carry no extension"))).toBe(true);
  });

  it.each(BUNDLER_WORKSPACE_FILES)("allows an extensionless relative import in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `import { x } from "./sibling";`);

    expect(messages.some((message) => message.includes("carry no extension"))).toBe(false);
  });

  it("leaves a bare package specifier alone", async () => {
    const messages = await restrictedSyntax(ADMIN_SRC, `import { x } from "@qp/ui/icons";`);

    expect(messages.some((message) => message.includes("carry no extension"))).toBe(false);
  });

  it.each(BUNDLER_WORKSPACE_FILES)("rejects a named re-export carrying .ts in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `export { x } from "./sibling.ts";`);

    expect(messages.some((message) => message.includes("carry no extension"))).toBe(true);
  });

  it.each(BUNDLER_WORKSPACE_FILES)("rejects a star re-export carrying .ts in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `export * from "./sibling.ts";`);

    expect(messages.some((message) => message.includes("carry no extension"))).toBe(true);
  });

  it.each(BUNDLER_WORKSPACE_FILES)("allows an extensionless re-export in %s", async (_, filePath) => {
    const namedMessages = await restrictedSyntax(filePath, `export { x } from "./sibling";`);
    const starMessages = await restrictedSyntax(filePath, `export * from "./sibling";`);

    expect(namedMessages.some((message) => message.includes("carry no extension"))).toBe(false);
    expect(starMessages.some((message) => message.includes("carry no extension"))).toBe(false);
  });
});

describe("L13: e2e/stack is a plain Node CLI, exempt from the other two rules but not from a misleading .js", () => {
  it("does not require .js there", async () => {
    const messages = await restrictedSyntax(E2E_STACK, `import { x } from "./sibling";`);

    expect(messages.some((message) => message.includes("compiled .js extension"))).toBe(false);
  });

  it("allows .ts there, which is the file that actually exists", async () => {
    const messages = await restrictedSyntax(E2E_STACK, `import { x } from "./sibling.ts";`);

    expect(messages.some((message) => message.includes("carry no extension"))).toBe(false);
    expect(messages.some((message) => message.includes("has no compiled output to answer to") || message.includes("names the .ts file that actually exists"))).toBe(false);
  });

  it("does not require .js on a re-export there", async () => {
    const messages = await restrictedSyntax(E2E_STACK, `export { x } from "./sibling";`);

    expect(messages.some((message) => message.includes("compiled .js extension"))).toBe(false);
  });

  it("allows .ts on a re-export there", async () => {
    const messages = await restrictedSyntax(E2E_STACK, `export { x } from "./sibling.ts";`);

    expect(messages.some((message) => message.includes("carry no extension"))).toBe(false);
  });

  it.each([
    ["a plain stack file", E2E_STACK],
    ["global-setup.ts, which also keeps its default export", E2E_STACK_GLOBAL_SETUP],
  ])("rejects the misleading .js extension in %s, since node never compiles it", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `import { x } from "./sibling.js";`);

    expect(messages.some((message) => message.includes("names the .ts file that actually exists"))).toBe(true);
  });

  it.each([
    ["a plain stack file", E2E_STACK],
    ["global-setup.ts, which also keeps its default export", E2E_STACK_GLOBAL_SETUP],
  ])("rejects a misleading .js re-export in %s", async (_, filePath) => {
    const messages = await restrictedSyntax(filePath, `export { x } from "./sibling.js";`);

    expect(messages.some((message) => message.includes("names the .ts file that actually exists"))).toBe(true);
  });
});
