import { runLeakFlow, type LeakFlow, type LeakRun, type LeakRunOptions } from "@qp/telemetry/leak-test";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildApp } from "../../src/app.js";
import { requestLogger } from "../../src/http/request-logger.js";
import type { TestDatabase } from "../db/fixtures.js";

export interface LeakWorld {
  readonly app: FastifyInstance;
  readonly testDatabase: TestDatabase;
  injectFailure(error: Error, urlSegment: string): Promise<number>;
}

async function buildLeakWorld(testDatabase: TestDatabase): Promise<LeakWorld> {
  let pendingFailure: Error | undefined;
  const app = await buildApp({
    logger: requestLogger("debug"),
    definition: { database: testDatabase.database("definition") },
    execution: { database: testDatabase.database("execution") },
    reporting: { reporting: testDatabase.database("reporting") },
  });
  app.get("/leak test/fail/:sessionId", async () => {
    throw pendingFailure ?? new Error("no failure was queued");
  });
  await app.ready();
  return {
    app,
    testDatabase,
    injectFailure: async (error, urlSegment) => {
      pendingFailure = error;
      const response = await app.inject({ method: "GET", url: `/leak test/fail/${urlSegment}` });
      return response.statusCode;
    },
  };
}

export function runOnLeakApp(
  testDatabase: TestDatabase,
  flow: LeakFlow<LeakWorld>,
  options: LeakRunOptions = {},
): Promise<LeakRun> {
  const buildsItsOwnApp: LeakFlow<undefined> = {
    name: flow.name,
    observesDatabase: flow.observesDatabase,
    run: async (_none, sentinel) => {
      const world = await buildLeakWorld(testDatabase);
      try {
        await flow.run(world, sentinel);
      } finally {
        await world.app.close();
      }
    },
  };
  return runLeakFlow(buildsItsOwnApp, undefined, { loadedDatabaseDriver: pg, ...options });
}
