import { reportingApi } from "@qp/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach } from "vitest";
import { reportingModule } from "../../../src/modules/reporting/plugin.js";
import type { TestDatabase } from "../../db/fixtures.js";

export function useReportingApp(testDatabase: TestDatabase): () => FastifyInstance {
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    app = Fastify();
    await app.register(reportingModule, {
      reporting: testDatabase.database("reporting"),
      snapshots: testDatabase.database("execution"),
      prefix: reportingApi.REPORTING_PREFIX,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  return () => {
    if (app === undefined) {
      throw new Error("the reporting app is built in beforeEach; read it inside a test");
    }
    return app;
  };
}
