import { definitionApi } from "@qp/shared";
import { withSpan } from "@qp/telemetry";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../../db/client.js";
import { createQuestionnaire, listQuestionnaireSummaries, setClosesAt } from "../../../db/definition/questionnaires.js";
import { registerRoute } from "../../../http/routes.js";
import { authorOf } from "../author.js";
import { reportClosesAtSet, reportQuestionnaireCreated } from "../definition-events.js";
import { definitionProblem } from "../problems.js";
import { auditTraceId } from "../../../http/trace.js";

export function registerQuestionnaireRoutes(scope: FastifyInstance, database: Database): void {
  registerRoute(scope, definitionApi.listQuestionnaires, async () => ({
    status: 200,
    body: await listQuestionnaireSummaries(database),
  }));

  registerRoute(scope, definitionApi.createQuestionnaire, async (request) => {
    const created = await withSpan("questionnaire.create", {}, async () => {
      const result = await createQuestionnaire(database, {
        key: request.body.key ?? null,
        name: request.body.name,
        title: request.body.title,
        createdBy: authorOf(request),
        traceId: auditTraceId(),
      });
      reportQuestionnaireCreated(result.questionnaireId);
      return result;
    });
    return { status: 201, body: created.summary };
  });

  registerRoute(scope, definitionApi.setClosesAt, async (request) => {
    const closesAt = request.body.closesAt;
    const updated = await withSpan("questionnaire.retire", { questionnaireId: request.params.id }, async () => {
      const closing = closesAt === null ? null : new Date(closesAt);
      const outcome = await setClosesAt(database, {
        questionnaireId: request.params.id,
        closesAt: closing,
        actorId: authorOf(request),
        traceId: auditTraceId(),
      });
      reportClosesAtSet(request.params.id, closing, outcome);
      return outcome;
    });
    if (updated.outcome !== "updated") {
      return definitionProblem(updated);
    }
    return { status: 200, body: updated.questionnaire };
  });
}
