import { executionApi } from "@qp/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, vi } from "vitest";
import { executionModule } from "../../../src/modules/execution/plugin.js";
import type { TestDatabase } from "../harness.js";

export const NOW = new Date("2026-09-14T10:00:00.000Z");

export function freezeTimeAt(instant: Date): void {
  vi.setSystemTime(instant);
}

export function useExecutionApp(testDatabase: TestDatabase): () => FastifyInstance {
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    freezeTimeAt(NOW);
    app = Fastify();
    await app.register(executionModule, {
      database: testDatabase.database("execution"),
      prefix: executionApi.EXECUTION_PREFIX,
    });
    await app.ready();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app?.close();
    app = undefined;
  });

  return () => {
    if (app === undefined) {
      throw new Error("the execution app is built in beforeEach; read it inside a test");
    }
    return app;
  };
}
