import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const AXE = `import axe from "axe-core";`;
const VITEST_AXE = `import { axe } from "vitest-axe";`;

const TESTING_MODULE = "packages/ui/src/testing/axe.ts";

const ADMIN_TEST = "apps/admin/_tests/screens/draft-editor/conditions.test.ts";
const RESPONDENT_TEST = "apps/respondent/_tests/app.test.tsx";
const UI_TEST = "packages/ui/_tests/primitives/dialog.test.tsx";
const BACKEND_TEST = "apps/backend/_tests/modules/definition/errors.test.ts";
const BACKEND_DB_TEST = "apps/backend/_tests/db/definition/drafts.test.ts";
const BACKEND_HARNESS = "apps/backend/_tests/db/harness.ts";
const TELEMETRY_TEST = "packages/telemetry/_tests/index.test.ts";

describe("L11: axe-core and vitest-axe only in @qp/ui/testing", () => {
  it("allows both in packages/ui/src/testing", async () => {
    expect(await restrictedImports(TESTING_MODULE, AXE)).toEqual([]);
    expect(await restrictedImports(TESTING_MODULE, VITEST_AXE)).toEqual([]);
  });

  it.each([
    ADMIN_TEST,
    RESPONDENT_TEST,
    UI_TEST,
    BACKEND_TEST,
    BACKEND_HARNESS,
    TELEMETRY_TEST,
    "packages/telemetry/src/index.ts",
    "packages/ui/src/questionnaire/questionnaire-form.tsx",
    "packages/ui/src/primitives/dialog.tsx",
    "apps/admin/src/app.tsx",
    "e2e/specs/smoke.spec.ts",
  ])("rejects both in %s", async (filePath) => {
    expect(await restrictedImports(filePath, AXE)).toHaveLength(1);
    expect(await restrictedImports(filePath, VITEST_AXE)).toHaveLength(1);
  });

  it("covers subpaths", async () => {
    expect(await restrictedImports(ADMIN_TEST, `import "vitest-axe/extend-expect";`)).toHaveLength(1);
    expect(await restrictedImports(UI_TEST, `import locale from "axe-core/locales/de.json";`)).toHaveLength(1);
  });

  it("keeps the inherited patterns inside @qp/ui/testing", async () => {
    expect(await restrictedImports(TESTING_MODULE, `import pino from "pino";`)).toHaveLength(1);
    expect(await restrictedImports(TESTING_MODULE, `import { Dialog } from "radix-ui";`)).toHaveLength(1);
  });
});

describe("L11: a _tests file imports no other directory's harness", () => {
  it.each([
    [ADMIN_TEST, "../question-editor/harness"],
    ["apps/admin/_tests/authoring-flow.test.tsx", "./screens/draft-editor/harness"],
    ["apps/admin/_tests/screens/draft-editor/harness.tsx", "../question-editor/harness.tsx"],
    [BACKEND_TEST, "../../db/harness.js"],
    ["apps/backend/_tests/modules/execution/boundary.test.ts", "../../db/execution/harness.js"],
    ["apps/respondent/_tests/storage/partials.test.ts", "../screens/harness.ts"],
    [RESPONDENT_TEST, "./screens/entry/harness.ts"],
    [UI_TEST, "../questionnaire/harness"],
    [TELEMETRY_TEST, "../src/sinks/harness"],
  ])("rejects %s importing %s", async (filePath, source) => {
    expect(await restrictedImports(filePath, `import { x } from "${source}";`)).toHaveLength(1);
  });

  it("rejects a type import too", async () => {
    expect(await restrictedImports(BACKEND_TEST, `import type { TestDatabase } from "../../db/harness.js";`)).toHaveLength(1);
  });

  it.each([
    ["apps/admin/_tests/features/question-editor/question-editor-dialog.test.tsx", "./harness"],
    ["apps/admin/_tests/screens/draft-editor.test.tsx", "./draft-editor/harness"],
    [BACKEND_DB_TEST, "../harness.js"],
    ["apps/backend/_tests/modules/definition/routes/drafts.test.ts", "../harness.js"],
    ["apps/backend/_tests/db/execution/fixtures.ts", "../harness.js"],
    ["apps/backend/_tests/modules/definition/harness.ts", "../../db/fixtures.js"],
    [ADMIN_TEST, "../../support/builders"],
    [ADMIN_TEST, "./harness-notes"],
  ])("allows %s importing %s", async (filePath, source) => {
    expect(await restrictedImports(filePath, `import { x } from "${source}";`)).toEqual([]);
  });

  it("leaves sources and the root lint tests alone", async () => {
    expect(await restrictedImports("apps/admin/src/screens/draft-editor.tsx", `import { x } from "../lib/harness";`)).toEqual([]);
    expect(await restrictedImports("tests/lint-globals.test.ts", `import { lintAs } from "./lint-harness.js";`)).toEqual([]);
  });
});

async function testSupportImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "@typescript-eslint/no-restricted-imports").map((m) => m.message);
}

describe("L11: production code does not import @qp/ui/testing", () => {
  it.each([
    "apps/admin/src/app.tsx",
    "apps/respondent/src/api/request.ts",
    "packages/ui/src/questionnaire/questionnaire-form.tsx",
    "packages/ui/src/primitives/dialog.tsx",
    "packages/shared/src/index.ts",
    "apps/backend/src/app.ts",
  ])("rejects @qp/ui/testing and its subpaths in %s", async (filePath) => {
    expect(await testSupportImports(filePath, `import { stubFetch } from "@qp/ui/testing";`)).toHaveLength(1);
    expect(await testSupportImports(filePath, `import { axeViolations } from "@qp/ui/testing/axe";`)).toHaveLength(1);
  });

  it.each([
    ["packages/ui/src/questionnaire/questionnaire-form.tsx", "../testing"],
    ["packages/ui/src/questionnaire/controls/date-control.tsx", "../../testing/fake-server"],
    ["packages/ui/src/index.ts", "./testing"],
  ])("rejects %s reaching the testing directory as %s", async (filePath, source) => {
    expect(await testSupportImports(filePath, `import { stubFetch } from "${source}";`)).toHaveLength(1);
  });

  it("allows the testing module's own files, every _tests directory and look-alike paths", async () => {
    expect(await testSupportImports("packages/ui/src/testing/index.ts", `export { axeViolations } from "./axe";`)).toEqual([]);
    expect(await testSupportImports("packages/ui/src/testing/axe.ts", `import { x } from "../testing/jsdom";`)).toEqual([]);
    expect(await testSupportImports(ADMIN_TEST, `import { stubFetch } from "@qp/ui/testing";`)).toEqual([]);
    expect(await testSupportImports(RESPONDENT_TEST, `import { FakeServer } from "@qp/ui/testing";`)).toEqual([]);
    expect(await testSupportImports(UI_TEST, `import { axeViolations } from "../../src/testing";`)).toEqual([]);
    expect(await testSupportImports("packages/ui/src/questionnaire/types.ts", `import { x } from "./testing-notes";`)).toEqual([]);
    expect(await testSupportImports("apps/admin/src/app.tsx", `import { Button } from "@qp/ui/primitives/button";`)).toEqual([]);
  });
});

describe("L11: production code does not import @qp/telemetry/testing or @qp/telemetry/leak-test", () => {
  it.each([
    "apps/backend/src/app.ts",
    "apps/backend/src/telemetry.ts",
    "apps/admin/src/app.tsx",
    "apps/respondent/src/api/request.ts",
    "packages/ui/src/questionnaire/questionnaire-form.tsx",
    "packages/shared/src/index.ts",
    "packages/telemetry/src/index.ts",
  ])("rejects both entry points in %s", async (filePath) => {
    expect(await testSupportImports(filePath, `import { installTestTelemetry } from "@qp/telemetry/testing";`)).toHaveLength(1);
    expect(await testSupportImports(filePath, `import { runLeakFlow } from "@qp/telemetry/leak-test";`)).toHaveLength(1);
  });

  it("allows tests, the package's own relative imports, and the production entry points", async () => {
    expect(await testSupportImports(BACKEND_TEST, `import { runLeakFlow } from "@qp/telemetry/leak-test";`)).toEqual([]);
    expect(await testSupportImports("apps/backend/_tests/leak-test/harness.ts", `import { installTestTelemetry } from "@qp/telemetry/testing";`)).toEqual([]);
    expect(await testSupportImports(TELEMETRY_TEST, `import { runLeakFlow } from "../src/leak-test.js";`)).toEqual([]);
    expect(await testSupportImports("packages/telemetry/src/leak-test.ts", `import { installTestTelemetry } from "./testing.js";`)).toEqual([]);
    expect(await testSupportImports("apps/backend/src/telemetry.ts", `import { startTelemetry } from "@qp/telemetry/node";`)).toEqual([]);
    expect(await testSupportImports("apps/admin/src/app.tsx", `import { logger } from "@qp/telemetry";`)).toEqual([]);
  });
});

describe("L11 restates what each _tests block inherits, because flat config replaces rule options", () => {
  it("keeps admin's and the respondent's library split in their tests", async () => {
    const query = `import { useQuery } from "@tanstack/react-query";`;
    const form = `import { useForm } from "@tanstack/react-form";`;

    expect(await restrictedImports(ADMIN_TEST, query)).toEqual([]);
    expect(await restrictedImports(ADMIN_TEST, form)).toHaveLength(1);
    expect(await restrictedImports(RESPONDENT_TEST, form)).toEqual([]);
    expect(await restrictedImports(RESPONDENT_TEST, query)).toHaveLength(1);
    expect(await restrictedImports(UI_TEST, `import { Dialog } from "radix-ui";`)).toHaveLength(1);
  });

  it("keeps the openDatabase restriction in backend tests and the harness's exemption from it", async () => {
    const openDatabase = `import { openDatabase } from "../../../src/db/client.js";`;

    expect(await restrictedImports(BACKEND_TEST, openDatabase)).toHaveLength(1);
    expect(await restrictedImports(BACKEND_DB_TEST, openDatabase)).toHaveLength(1);
    expect(await restrictedImports(BACKEND_HARNESS, `import { openDatabase } from "../../src/db/client.js";`)).toEqual([]);
  });

  it("keeps pino out of every _tests directory but the telemetry package's", async () => {
    const pino = `import pino from "pino";`;

    expect(await restrictedImports(ADMIN_TEST, pino)).toHaveLength(1);
    expect(await restrictedImports(BACKEND_TEST, pino)).toHaveLength(1);
    expect(await restrictedImports(UI_TEST, pino)).toHaveLength(1);
    expect(await restrictedImports(TELEMETRY_TEST, pino)).toEqual([]);
    expect(await restrictedImports("packages/telemetry/src/index.ts", pino)).toEqual([]);
  });
});
