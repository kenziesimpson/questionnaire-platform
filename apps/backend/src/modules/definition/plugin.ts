import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import { replyNotFound, requestValidatorCompiler } from "../../http/problems.js";
import { authenticateAuthor } from "./author.js";
import { replyWithDefinitionProblem } from "./errors.js";
import { draftRoutes } from "./routes/drafts.js";
import { questionnaireRoutes } from "./routes/questionnaires.js";
import { questionRoutes } from "./routes/questions.js";
import { versionRoutes } from "./routes/versions.js";

export interface DefinitionModuleOptions {
  readonly database: Database;
}

export async function definitionModule(scope: FastifyInstance, options: DefinitionModuleOptions): Promise<void> {
  scope.setValidatorCompiler(requestValidatorCompiler());
  scope.setErrorHandler(replyWithDefinitionProblem);
  scope.setNotFoundHandler(replyNotFound);
  scope.addHook("onRequest", authenticateAuthor);

  const routeOptions = { database: options.database };
  await scope.register(questionnaireRoutes, routeOptions);
  await scope.register(questionRoutes, routeOptions);
  await scope.register(draftRoutes, routeOptions);
  await scope.register(versionRoutes, routeOptions);
}
