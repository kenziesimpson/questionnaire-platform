import { definitionApi } from "@qp/shared";
import type { FastifyInstance } from "fastify";
import { listQuestionnaireSummaries } from "../../../db/definition/questionnaires.js";
import { registerRoute } from "../../../http/routes.js";
import type { DefinitionModuleOptions } from "../plugin.js";

export async function questionnaireListRoutes(scope: FastifyInstance, { database }: DefinitionModuleOptions): Promise<void> {
  registerRoute(scope, definitionApi.listQuestionnaires, async () => ({
    status: 200,
    body: await listQuestionnaireSummaries(database),
  }));
}
