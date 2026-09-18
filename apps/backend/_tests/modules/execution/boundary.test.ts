import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { executionApi, INTAKE_QUESTIONNAIRE_ID, PROBLEM_CONTENT_TYPE, problem } from "@qp/shared";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- an unreachable database is this test's subject: it opens a handle only to close it before the request
import { openDatabase } from "../../../src/db/client.js";
import {
  question,
  questionnaire,
  questionnaireItem,
  questionnaireVersion,
  questionVersion,
  questionVersionOption,
} from "../../../src/db/schema.js";
import { executionModule } from "../../../src/modules/execution/plugin.js";
import { answersYes, executionUrl, seedIntakeV1, startedSessionId, submit, useExecutionApp } from "../../db/execution/fixtures.js";
import { expectSqlState, SQLSTATE, useTestDatabase } from "../../db/harness.js";

const testDatabase = useTestDatabase();
const executionApp = useExecutionApp(testDatabase);

const EXECUTION_SOURCE_DIRECTORIES = ["modules", "db"].map((layer) =>
  fileURLToPath(new URL(`../../../src/${layer}/execution/`, import.meta.url)),
);

const DEFINITION_SIDE_IMPORT = /from\s*"[./]*(?:db\/)?(?:(?:definition|seed)\/|audit(?:\.[cm]?[jt]s)?")/;

const DEFINITION_SIDE_IMPORT_SPELLINGS = [
  `import { publishDraft } from "../../db/definition/publish.js";`,
  `import { publishDraft } from "../definition/publish.js";`,
  `import { seedDemoQuestionnaire } from "../../db/seed/demo-questionnaire.js";`,
  `import { seedDemoQuestionnaire } from "../seed/demo-questionnaire.js";`,
  `import { recordAudit } from "../../db/audit.js";`,
  `import { recordAudit } from "../audit.js";`,
  `import { recordAudit } from "../audit";`,
  `export { recordAudit } from "../audit.js";`,
];

async function executionSources(): Promise<string> {
  const perDirectory = await Promise.all(
    EXECUTION_SOURCE_DIRECTORIES.map(async (directory) => {
      const files = await readdir(directory, { recursive: true });
      return Promise.all(files.filter((file) => file.endsWith(".ts")).map((file) => readFile(`${directory}${file}`, "utf8")));
    }),
  );
  return perDirectory.flat().join("\n");
}

describe("the execution module on its own", () => {
  it("drives a session from start to submission on a bare Fastify instance with nothing from the definition half registered", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();

    const sessionId = await startedSessionId(app);
    const submitted = await submit(app, sessionId, answersYes());

    expect(submitted.statusCode).toBe(200);
    expect(app.printRoutes({ commonPrefix: false })).not.toContain("definition");
  });

  it("runs as qp_execution, which cannot read any authoring table", async () => {
    const database = testDatabase.database("execution");

    const identity = await database.execute<{ current_user: string }>(
      // eslint-disable-next-line no-restricted-syntax -- current_user is a Postgres session function, and asking the module's own handle which role it connected as is the point of the test; the query builder cannot select it
      sql`SELECT current_user`,
    );

    expect(identity.rows[0]?.current_user).toBe("qp_execution");
    for (const table of [question, questionVersion, questionVersionOption, questionnaireItem, questionnaireVersion]) {
      await expectSqlState(database.select().from(table).limit(1), SQLSTATE.insufficientPrivilege);
    }
    await expectSqlState(database.update(questionnaire).set({ closesAt: new Date() }), SQLSTATE.insufficientPrivilege);
  });

  it("imports from the schema only the execution tables, the questionnaire row it is granted, and the definition schema for the published view", async () => {
    const source = await executionSources();
    const schemaImports = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"[./]*(?:db\/)?schema\.js"/g)]
      .flatMap((match) => match[1]!.split(","))
      .map((name) => name.trim())
      .filter((name) => name !== "");

    expect(new Set(schemaImports)).toEqual(new Set(["definitionSchema", "questionnaire", "response", "session"]));
    expect(source).toContain('.view("published_questionnaire_version"');
    expect(DEFINITION_SIDE_IMPORT_SPELLINGS.filter((line) => !DEFINITION_SIDE_IMPORT.test(line))).toEqual([]);
    expect(source).not.toMatch(DEFINITION_SIDE_IMPORT);
  });
});

describe("an unhandled failure", () => {
  it("is 500 internal whose detail is the request id, carrying no error text", async () => {
    const unreachable = openDatabase(testDatabase.url("execution"));
    await unreachable.close();
    const app = Fastify({ genReqId: () => "req-correlation-1" });
    await app.register(executionModule, { database: unreachable.db, prefix: executionApi.EXECUTION_PREFIX });

    const response = await app.inject({ method: "POST", url: executionUrl("/sessions"), payload: { questionnaireId: INTAKE_QUESTIONNAIRE_ID } });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toEqual(problem("internal", { detail: "req-correlation-1" }));
    await app.close();
  });
});
