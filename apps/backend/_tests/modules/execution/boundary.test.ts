import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { executionApi, INTAKE_QUESTIONNAIRE_ID, intakeDefinition } from "@qp/shared";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import { openDatabase } from "../../../src/db/client.js";
import { executionModule } from "../../../src/modules/execution/plugin.js";
import { expectSqlState, SQLSTATE, useTestDatabase } from "../../db/harness.js";
import { anExecutionApp, answersYes, NOW, seedIntakeV1, startedSessionId, submit } from "./fixtures.js";

const testDatabase = useTestDatabase();

const EXECUTION_MODULE = fileURLToPath(new URL("../../../src/modules/execution/", import.meta.url));

async function executionModuleSources(): Promise<string> {
  const files = await readdir(EXECUTION_MODULE, { recursive: true });
  const sources = await Promise.all(
    files.filter((file) => file.endsWith(".ts")).map((file) => readFile(`${EXECUTION_MODULE}${file}`, "utf8")),
  );
  return sources.join("\n");
}

describe("the execution module on its own", () => {
  it("drives a session from start to submission on a bare Fastify instance with nothing from the definition half registered", async () => {
    await seedIntakeV1(testDatabase);
    const { app } = await anExecutionApp(testDatabase);

    const sessionId = await startedSessionId(app);
    const submitted = await submit(app, sessionId, answersYes());

    expect(submitted.statusCode).toBe(200);
    expect(app.printRoutes({ commonPrefix: false })).not.toContain("definition");
  });

  it("runs as qp_execution, which cannot read any authoring table", async () => {
    const database = testDatabase.database("execution");

    const identity = await database.execute<{ current_user: string }>(sql`SELECT current_user`);

    expect(identity.rows[0]?.current_user).toBe("qp_execution");
    for (const table of ["question", "question_version", "question_version_option", "questionnaire_item", "questionnaire_version"]) {
      await expectSqlState(database.execute(sql.raw(`SELECT 1 FROM definition.${table} LIMIT 1`)), SQLSTATE.insufficientPrivilege);
    }
  });

  it("imports from the schema only the execution tables, the questionnaire row it is granted, and the definition schema for the published view", async () => {
    const source = await executionModuleSources();
    const schemaImports = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"[./]*db\/schema\.js"/g)]
      .flatMap((match) => match[1]!.split(","))
      .map((name) => name.trim())
      .filter((name) => name !== "");

    expect(new Set(schemaImports)).toEqual(new Set(["definitionSchema", "questionnaire", "response", "session"]));
    expect(source).toContain('.view("published_questionnaire_version"');
    expect(source).not.toMatch(/from\s*"[./]*db\/(definition|seed)\//);
  });
});

describe("an unhandled failure", () => {
  it("is 500 internal whose detail is the request id, carrying no error text", async () => {
    const unreachable = openDatabase(testDatabase.url("execution"));
    await unreachable.close();
    const app = Fastify({ genReqId: () => "req-correlation-1" });
    await app.register(executionModule, { database: unreachable.db, prefix: executionApi.EXECUTION_PREFIX });

    const response = await app.inject({ method: "POST", url: "/api/run/sessions", payload: { questionnaireId: INTAKE_QUESTIONNAIRE_ID } });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toEqual({
      type: "https://qp.example/problems/internal",
      title: "Internal error",
      status: 500,
      detail: "req-correlation-1",
    });
    await app.close();
  });
});

describe("buildApp", () => {
  it("mounts the execution module at /api/run and answers unknown routes with problem details", async () => {
    await seedIntakeV1(testDatabase);
    const app = await buildApp({ execution: { database: testDatabase.database("execution"), clock: () => NOW } });

    const started = await app.inject({ method: "POST", url: "/api/run/sessions", payload: { questionnaireId: INTAKE_QUESTIONNAIRE_ID } });
    const unknownRun = await app.inject({ method: "GET", url: "/api/run/questionnaires/current" });
    const unknownRoot = await app.inject({ method: "GET", url: "/nowhere" });

    expect(started.statusCode).toBe(201);
    expect(started.json().definition).toEqual(intakeDefinition(1));
    for (const response of [unknownRun, unknownRoot]) {
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }
    await app.close();
  });
});
