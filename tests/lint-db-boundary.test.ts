import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const EXECUTION = "apps/backend/src/modules/execution/submit.ts";
const NESTED_EXECUTION = "apps/backend/src/modules/execution/routes/sessions.ts";
const DB_DEFINITION = "apps/backend/src/db/definition/publish.ts";
const NESTED_DB_DEFINITION = "apps/backend/src/db/definition/drafts/contents.ts";

describe("execution never imports the definition side of the db layer", () => {
  it.each([
    ["db/definition", EXECUTION, `import { publish } from "../../db/definition/publish.js";`],
    ["db/definition from a nested file", NESTED_EXECUTION, `import { publish } from "../../../db/definition/publish.js";`],
    ["the db/definition directory itself", EXECUTION, `import * as definition from "../../db/definition";`],
    ["db/seed", EXECUTION, `import { seed } from "../../db/seed/seed.js";`],
    ["db/seed from a nested file", NESTED_EXECUTION, `import { demo } from "../../../db/seed/demo-questionnaire.js";`],
    ["db/audit", EXECUTION, `import { withAudit } from "../../db/audit.js";`],
    ["db/audit without an extension", NESTED_EXECUTION, `import { withAudit } from "../../../db/audit";`],
    ["a type-only import", EXECUTION, `import type { Draft } from "../../db/definition/draft-contents.js";`],
    ["a re-export", EXECUTION, `export { publish } from "../../db/definition/publish.js";`],
    ["db/definition through a ./ segment", EXECUTION, `import { publish } from "../../db/./definition/publish.js";`],
    ["db/seed through a doubled slash", EXECUTION, `import { seed } from "../../db//seed/seed.js";`],
    ["db/audit through ./ segments", NESTED_EXECUTION, `import { withAudit } from "../.././../db/././audit.js";`],
  ])("rejects %s", async (_, filePath, code) => {
    const messages = await restrictedImports(filePath, code);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("db/definition, db/seed and db/audit");
  });

  it("allows db/client, db/schema and the rest of the db layer", async () => {
    const code = [
      `import { openDatabase } from "../../db/client.js";`,
      `import { sessions } from "../../db/schema.js";`,
      `import { ensurePartitions } from "../../db/partitions.js";`,
      `import { lock } from "../../db/execution/sessions.js";`,
      `import { trail } from "../../db/audit-trail.js";`,
      `import { lock } from "../../db/./client.js";`,
    ].join("\n");

    expect(await restrictedImports(EXECUTION, code)).toEqual([]);
    expect(await restrictedImports(NESTED_EXECUTION, code.replaceAll("../../db/", "../../../db/"))).toEqual([]);
  });

  it("still rejects the definition module and telemetry, which this rule inherits", async () => {
    expect(await restrictedImports(EXECUTION, `import { x } from "../definition/repository.js";`)).toHaveLength(1);
    expect(await restrictedImports(EXECUTION, `import pino from "pino";`)).toHaveLength(1);
    expect(await restrictedImports(NESTED_EXECUTION, `import { trace } from "@opentelemetry/api";`)).toHaveLength(1);
  });
});

describe("db/definition never imports a backend module", () => {
  it.each([
    ["the definition module", DB_DEFINITION, `import { x } from "../../modules/definition/routes/publish.js";`],
    ["the execution module", DB_DEFINITION, `import { x } from "../../modules/execution/submit.js";`],
    ["a module from a nested file", NESTED_DB_DEFINITION, `import { x } from "../../../modules/definition/index.js";`],
    ["the modules directory itself", DB_DEFINITION, `import * as modules from "../../modules";`],
    ["a type-only import", DB_DEFINITION, `import type { X } from "../../modules/definition/types.js";`],
    ["a module through ./ segments", DB_DEFINITION, `import { x } from "../.././modules/./execution/submit.js";`],
  ])("rejects %s", async (_, filePath, code) => {
    const messages = await restrictedImports(filePath, code);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("imports none of them");
  });

  it("allows the rest of the db layer, @qp/shared and its own files", async () => {
    const code = [
      `import { withAudit } from "../audit.js";`,
      `import { openDatabase } from "../client.js";`,
      `import { questionnaires } from "../schema.js";`,
      `import { readItems } from "./draft-contents.js";`,
      `import { PublishedDefinition } from "@qp/shared";`,
    ].join("\n");

    expect(await restrictedImports(DB_DEFINITION, code)).toEqual([]);
  });

  it("still rejects telemetry, which this rule inherits", async () => {
    expect(await restrictedImports(DB_DEFINITION, `import pino from "pino";`)).toHaveLength(1);
    expect(await restrictedImports(NESTED_DB_DEFINITION, `import { trace } from "@opentelemetry/api";`)).toHaveLength(1);
  });

  it("does not apply outside db/definition", async () => {
    const code = `import { routes } from "./modules/execution/routes.js";`;

    expect(await restrictedImports("apps/backend/src/app.ts", code)).toEqual([]);
  });
});
