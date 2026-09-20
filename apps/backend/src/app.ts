import { randomUUID } from "node:crypto";
import { definitionApi, executionApi, reportingApi, telemetryApi } from "@qp/shared";
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { isHealthRequest, registerHealthRoutes, selectOne } from "./http/health.js";
import { applyHttpDefaults, replyWithProblem } from "./http/problems.js";
import { definitionModule, type DefinitionModuleOptions } from "./modules/definition/plugin.js";
import { executionModule, type ExecutionModuleOptions } from "./modules/execution/plugin.js";
import { reportingModule, type ReportingModuleOptions } from "./modules/reporting/plugin.js";
import { telemetryModule } from "./modules/telemetry/plugin.js";

const TRUSTED_PROXY_HOPS = 1;

export function trustNearestProxy(_address: string, hop: number): boolean {
  return hop < TRUSTED_PROXY_HOPS;
}

export interface AppOptions {
  readonly logger?: FastifyBaseLogger;
  readonly definition: DefinitionModuleOptions;
  readonly execution: ExecutionModuleOptions;
  readonly reporting: ReportingModuleOptions;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    ...(options.logger === undefined ? { logger: false } : { loggerInstance: options.logger }),
    logController: new LogController({ disableRequestLogging: (request) => isHealthRequest(request.url) }),
    genReqId: () => randomUUID(),
    trustProxy: trustNearestProxy,
    frameworkErrors: replyWithProblem,
  });

  applyHttpDefaults(app, replyWithProblem);
  registerHealthRoutes(app, {
    definition: () => selectOne(options.definition.database),
    execution: () => selectOne(options.execution.database),
    reporting: () => selectOne(options.reporting.reporting),
  });
  await app.register(definitionModule, { ...options.definition, prefix: definitionApi.DEFINITION_PREFIX });
  await app.register(executionModule, { ...options.execution, prefix: executionApi.EXECUTION_PREFIX });
  await app.register(reportingModule, { ...options.reporting, prefix: reportingApi.REPORTING_PREFIX });
  await app.register(telemetryModule, { prefix: telemetryApi.TELEMETRY_PREFIX });

  return app;
}
