import { definitionApi } from "@qp/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll } from "vitest";
import { definitionModule } from "../../../src/modules/definition/plugin.js";
import type { TestDatabase } from "../../db/harness.js";

export function definitionUrl(path: string): string {
  return `${definitionApi.DEFINITION_PREFIX}${path}`;
}

export function useDefinitionApp(testDatabase: TestDatabase): () => FastifyInstance {
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    app = Fastify();
    await app.register(definitionModule, {
      database: testDatabase.database("definition"),
      prefix: definitionApi.DEFINITION_PREFIX,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  return () => {
    if (app === undefined) {
      throw new Error("the definition app is built in beforeAll; read it inside a test");
    }
    return app;
  };
}
