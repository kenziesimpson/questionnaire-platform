import { definitionApi } from "@qp/shared";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../../db/client.js";
import { createQuestionnaire, listQuestionnaireSummaries, setClosesAt } from "../../../db/definition/questionnaires.js";
import { registerRoute } from "../../../http/routes.js";
import { authorOf } from "../author.js";
import { definitionProblem } from "../problems.js";

export function registerQuestionnaireRoutes(scope: FastifyInstance, database: Database): void {
  registerRoute(scope, definitionApi.listQuestionnaires, async () => ({
    status: 200,
    body: await listQuestionnaireSummaries(database),
  }));

  registerRoute(scope, definitionApi.createQuestionnaire, async (request) => {
    const created = await createQuestionnaire(database, {
      key: request.body.key ?? null,
      name: request.body.name,
      title: request.body.title,
      createdBy: authorOf(request),
      traceId: null,
    });
    return { status: 201, body: created.summary };
  });

  registerRoute(scope, definitionApi.setClosesAt, async (request) => {
    const closesAt = request.body.closesAt;
    const updated = await setClosesAt(database, {
      questionnaireId: request.params.id,
      closesAt: closesAt === null ? null : new Date(closesAt),
      actorId: authorOf(request),
      traceId: null,
    });
    if (updated.outcome !== "updated") {
      return definitionProblem(updated, request.url);
    }
    return { status: 200, body: updated.questionnaire };
  });
}
