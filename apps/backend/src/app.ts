import { randomUUID } from "node:crypto";
import { executionApi } from "@qp/shared";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { replyNotFound } from "./http/problems.js";
import { executionModule, type ExecutionModuleOptions } from "./modules/execution/plugin.js";

export interface AppOptions {
  readonly logger?: FastifyServerOptions["logger"];
  readonly execution: ExecutionModuleOptions;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, genReqId: () => randomUUID() });

  app.setNotFoundHandler(replyNotFound);
  app.get("/health", async () => ({ status: "ok" }));
  await app.register(executionModule, { ...options.execution, prefix: executionApi.EXECUTION_PREFIX });

  return app;
}
