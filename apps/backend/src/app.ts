import { randomUUID } from "node:crypto";
import { definitionApi, executionApi } from "@qp/shared";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { replyNotFound, replyWithProblem } from "./http/problems.js";
import { definitionModule, type DefinitionModuleOptions } from "./modules/definition/plugin.js";
import { executionModule, type ExecutionModuleOptions } from "./modules/execution/plugin.js";

export interface AppOptions {
  readonly logger?: FastifyServerOptions["logger"];
  readonly definition: DefinitionModuleOptions;
  readonly execution: ExecutionModuleOptions;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, genReqId: () => randomUUID() });

  app.setNotFoundHandler(replyNotFound);
  app.setErrorHandler(replyWithProblem);
  app.get("/health", async () => ({ status: "ok" }));
  await app.register(definitionModule, { ...options.definition, prefix: definitionApi.DEFINITION_PREFIX });
  await app.register(executionModule, { ...options.execution, prefix: executionApi.EXECUTION_PREFIX });

  return app;
}
