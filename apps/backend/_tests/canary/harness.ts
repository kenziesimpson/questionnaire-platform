import { runCanaryFlow, type CanaryFlow, type CanaryRun, type CanaryRunOptions } from "@qp/telemetry/canary";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { requestLogger } from "../../src/http/request-logger.js";
import type { TestDatabase } from "../db/fixtures.js";

export interface CanaryWorld {
  readonly app: FastifyInstance;
  readonly testDatabase: TestDatabase;
  injectFailure(error: Error, urlSegment: string): Promise<number>;
}

async function buildCanaryWorld(testDatabase: TestDatabase): Promise<CanaryWorld> {
  let pendingFailure: Error | undefined;
  const app = await buildApp({
    logger: requestLogger("debug"),
    definition: { database: testDatabase.database("definition") },
    execution: { database: testDatabase.database("execution") },
    reporting: { reporting: testDatabase.database("reporting") },
  });
  app.get("/canary/fail/:sessionId", async () => {
    throw pendingFailure ?? new Error("no failure was queued");
  });
  await app.ready();
  return {
    app,
    testDatabase,
    injectFailure: async (error, urlSegment) => {
      pendingFailure = error;
      const response = await app.inject({ method: "GET", url: `/canary/fail/${urlSegment}` });
      return response.statusCode;
    },
  };
}

export function runOnCanaryApp(
  testDatabase: TestDatabase,
  flow: CanaryFlow<CanaryWorld>,
  options: CanaryRunOptions = {},
): Promise<CanaryRun> {
  const buildsItsOwnApp: CanaryFlow<undefined> = {
    name: flow.name,
    run: async (_none, sentinel) => {
      const world = await buildCanaryWorld(testDatabase);
      try {
        await flow.run(world, sentinel);
      } finally {
        await world.app.close();
      }
    },
  };
  return runCanaryFlow(buildsItsOwnApp, undefined, options);
}
