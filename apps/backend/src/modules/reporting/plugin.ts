import { reportingApi } from "@qp/shared";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import { PublishedDefinitions } from "../../db/execution/published-definitions.js";
import { getSessionDetail, listSessionSummaries, questionnaireExistsForReporting } from "../../db/reporting/sessions.js";
import { applyHttpDefaults, notFoundProblem, replyWithProblem } from "../../http/problems.js";
import { registerRoute } from "../../http/routes.js";

export interface ReportingModuleOptions {
  readonly reporting: Database;
}

export async function reportingModule(scope: FastifyInstance, { reporting }: ReportingModuleOptions): Promise<void> {
  const definitions = new PublishedDefinitions();

  applyHttpDefaults(scope, replyWithProblem);
  scope.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  registerRoute(scope, reportingApi.listSessions, async (request) => {
    if (!(await questionnaireExistsForReporting(reporting, request.params.id))) {
      return notFoundProblem();
    }
    const page = await listSessionSummaries(reporting, definitions, {
      questionnaireId: request.params.id,
      status: request.query.status,
      version: request.query.version,
      sort: request.query.sort,
      order: request.query.order,
      cursor: request.query.cursor,
    });
    return { status: 200, body: page };
  });

  registerRoute(scope, reportingApi.getSessionDetail, async (request) => {
    const outcome = await getSessionDetail(reporting, definitions, request.params.id, request.params.sessionId);
    if (outcome.outcome !== "found") {
      return notFoundProblem();
    }
    return { status: 200, body: outcome.detail };
  });
}
