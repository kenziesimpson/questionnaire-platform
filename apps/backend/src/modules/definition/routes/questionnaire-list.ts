import { definitionApi } from "@qp/shared";
import type { FastifyInstance } from "fastify";
import { listQuestionnaireSummaries } from "../../../db/definition/questionnaire-list.js";
import type { DefinitionModuleOptions } from "../plugin.js";

export async function questionnaireListRoutes(scope: FastifyInstance, { database }: DefinitionModuleOptions): Promise<void> {
  scope.route({
    ...definitionApi.listQuestionnaires,
    handler: async () => listQuestionnaireSummaries(database),
  });
}
