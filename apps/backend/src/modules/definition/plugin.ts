import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import { applyHttpDefaults } from "../../http/problems.js";
import { authenticateAuthor } from "./author.js";
import { replyWithDefinitionProblem } from "./errors.js";
import { registerDraftRoutes } from "./routes/drafts.js";
import { registerQuestionnaireRoutes } from "./routes/questionnaires.js";
import { registerQuestionRoutes } from "./routes/questions.js";
import { registerVersionRoutes } from "./routes/versions.js";

export interface DefinitionModuleOptions {
  readonly database: Database;
}

export async function definitionModule(scope: FastifyInstance, { database }: DefinitionModuleOptions): Promise<void> {
  applyHttpDefaults(scope, replyWithDefinitionProblem);
  scope.addHook("onRequest", authenticateAuthor);

  registerQuestionnaireRoutes(scope, database);
  registerQuestionRoutes(scope, database);
  registerDraftRoutes(scope, database);
  registerVersionRoutes(scope, database);
}
