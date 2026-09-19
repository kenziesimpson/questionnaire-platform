import { reportingApi } from "@qp/shared";
import { activeTraceId, emitDomainEvent, withSpan } from "@qp/telemetry";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import { PublishedDefinitions } from "../../db/execution/published-definitions.js";
import { getSessionDetail, listSessionSummaries, questionnaireExistsForReporting } from "../../db/reporting/sessions.js";
import { applyHttpDefaults, notFoundProblem, replyWithProblem } from "../../http/problems.js";
import { registerRoute } from "../../http/routes.js";

export interface ReportingModuleOptions {
  readonly reporting: Database;
}

const READER_PLACEHOLDER = "prototype-author";

export async function reportingModule(scope: FastifyInstance, { reporting }: ReportingModuleOptions): Promise<void> {
  const definitions = new PublishedDefinitions();

  applyHttpDefaults(scope, replyWithProblem);
  scope.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  registerRoute(scope, reportingApi.listSessions, async (request) => {
    const questionnaireId = request.params.id;
    const page = await withSpan("reporting.list_sessions", { questionnaireId }, async () => {
      if (!(await questionnaireExistsForReporting(reporting, questionnaireId))) {
        return undefined;
      }
      const listed = await listSessionSummaries(reporting, definitions, {
        questionnaireId,
        status: request.query.status,
        version: request.query.version,
        sort: request.query.sort,
        order: request.query.order,
        cursor: request.query.cursor,
      });
      emitDomainEvent({ name: "reporting.responses_listed", questionnaireId });
      return listed;
    });
    if (page === undefined) {
      return notFoundProblem();
    }
    return { status: 200, body: page };
  });

  registerRoute(scope, reportingApi.getSessionDetail, async (request) => {
    const { id: questionnaireId, sessionId } = request.params;
    const outcome = await withSpan("reporting.session_detail", { questionnaireId, sessionId }, async () => {
      const read = await getSessionDetail(reporting, definitions, questionnaireId, sessionId, {
        actorId: READER_PLACEHOLDER,
        traceId: activeTraceId() ?? null,
      });
      if (read.outcome === "found") {
        emitDomainEvent({ name: "reporting.response_viewed", questionnaireId, sessionId });
      }
      return read;
    });
    if (outcome.outcome !== "found") {
      return notFoundProblem();
    }
    return { status: 200, body: outcome.detail };
  });
}
