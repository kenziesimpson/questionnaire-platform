import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { requestLogger } from "../../src/http/request-logger.js";
import type { TestDatabase } from "../db/fixtures.js";

export interface CanaryWorld {
  readonly app: FastifyInstance;
  readonly testDatabase: TestDatabase;
}

export function useCanaryWorld(testDatabase: TestDatabase): () => CanaryWorld {
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    app = await buildApp({
      logger: requestLogger("debug"),
      definition: { database: testDatabase.database("definition") },
      execution: { database: testDatabase.database("execution") },
      reporting: { reporting: testDatabase.database("reporting") },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  return () => {
    if (app === undefined) {
      throw new Error("the canary app is built in beforeEach; read it inside a test");
    }
    return { app, testDatabase };
  };
}
