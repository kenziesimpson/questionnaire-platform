import { randomUUID } from "node:crypto";
import { definitionApi, executionApi, reportingApi } from "@qp/shared";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { applyHttpDefaults, replyWithProblem } from "./http/problems.js";
import { definitionModule, type DefinitionModuleOptions } from "./modules/definition/plugin.js";
import { executionModule, type ExecutionModuleOptions } from "./modules/execution/plugin.js";
import { reportingModule, type ReportingModuleOptions } from "./modules/reporting/plugin.js";

export interface AppOptions {
  readonly logger?: FastifyServerOptions["logger"];
  readonly definition: DefinitionModuleOptions;
  readonly execution: ExecutionModuleOptions;
  readonly reporting: ReportingModuleOptions;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, genReqId: () => randomUUID(), frameworkErrors: replyWithProblem });

  applyHttpDefaults(app, replyWithProblem);
  app.get("/health", async () => ({ status: "ok" }));
  await app.register(definitionModule, { ...options.definition, prefix: definitionApi.DEFINITION_PREFIX });
  await app.register(executionModule, { ...options.execution, prefix: executionApi.EXECUTION_PREFIX });
  await app.register(reportingModule, { ...options.reporting, prefix: reportingApi.REPORTING_PREFIX });

  return app;
}
