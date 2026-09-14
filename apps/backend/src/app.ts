import { randomUUID } from "node:crypto";
import { definitionApi } from "@qp/shared";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { replyNotFound, replyWithProblem } from "./http/problems.js";
import { definitionModule, type DefinitionModuleOptions } from "./modules/definition/plugin.js";

export interface AppOptions {
  readonly logger?: FastifyServerOptions["logger"];
  readonly definition: DefinitionModuleOptions;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, genReqId: () => randomUUID() });

  app.setNotFoundHandler(replyNotFound);
  app.setErrorHandler(replyWithProblem);
  app.get("/health", async () => ({ status: "ok" }));
  await app.register(definitionModule, { ...options.definition, prefix: definitionApi.DEFINITION_PREFIX });

  return app;
}
