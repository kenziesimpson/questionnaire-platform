import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { requestLogger } from "../../src/http/request-logger.js";
import type { TestDatabase } from "../db/fixtures.js";

export interface CanaryWorld {
  readonly app: FastifyInstance;
  readonly testDatabase: TestDatabase;
  injectFailure(error: Error, urlSegment: string): Promise<number>;
}

export function useCanaryWorld(testDatabase: TestDatabase): () => CanaryWorld {
  let app: FastifyInstance | undefined;
  let pendingFailure: Error | undefined;

  beforeEach(async () => {
    pendingFailure = undefined;
    app = await buildApp({
      logger: requestLogger("debug"),
      definition: { database: testDatabase.database("definition") },
      execution: { database: testDatabase.database("execution") },
      reporting: { reporting: testDatabase.database("reporting") },
    });
    app.get("/canary/fail/:sessionId", async () => {
      throw pendingFailure ?? new Error("no failure was queued");
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
    const running = app;
    return {
      app: running,
      testDatabase,
      injectFailure: async (error, urlSegment) => {
        pendingFailure = error;
        const response = await running.inject({ method: "GET", url: `/canary/fail/${urlSegment}` });
        return response.statusCode;
      },
    };
  };
}
