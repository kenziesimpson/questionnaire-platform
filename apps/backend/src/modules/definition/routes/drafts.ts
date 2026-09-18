import { definitionApi, formatDraftEtag } from "@qp/shared";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../../db/client.js";
import {
  createNextDraft,
  readDraft,
  replaceDraft,
  validateOpenDraft,
  type CurrentDraft,
} from "../../../db/definition/drafts.js";
import { publishDraft } from "../../../db/definition/publish.js";
import { notFoundProblem } from "../../../http/problems.js";
import { registerRoute } from "../../../http/routes.js";
import { authorOf } from "../author.js";
import { draftPreconditionOf } from "../if-match.js";
import { definitionProblem } from "../problems.js";

function draftHeaders({ draft, draftRevision }: CurrentDraft): Record<string, string> {
  return { etag: formatDraftEtag(draft.versionId, draftRevision), "cache-control": "no-store" };
}

export function registerDraftRoutes(scope: FastifyInstance, database: Database): void {
  registerRoute(scope, definitionApi.getDraft, async (request) => {
    const current = await readDraft(database, request.params.id);
    if (current === undefined) {
      return notFoundProblem();
    }
    return { status: 200, body: current.draft, headers: draftHeaders(current) };
  });

  registerRoute(scope, definitionApi.replaceDraft, async (request) => {
    const precondition = draftPreconditionOf(request.headers["if-match"]);
    if ("status" in precondition) {
      return precondition;
    }
    const { title, items } = request.body;
    const outcome = await replaceDraft(database, {
      questionnaireId: request.params.id,
      precondition,
      title,
      items,
      actorId: authorOf(request),
      traceId: null,
    });
    if (outcome.outcome !== "saved") {
      return definitionProblem(outcome);
    }
    return { status: 200, body: outcome.draft, headers: draftHeaders(outcome) };
  });

  registerRoute(scope, definitionApi.openDraft, async (request) => {
    const outcome = await createNextDraft(database, {
      questionnaireId: request.params.id,
      createdBy: authorOf(request),
      traceId: null,
    });
    if (outcome.outcome !== "created") {
      return definitionProblem(outcome);
    }
    return { status: 201, body: outcome.draft, headers: draftHeaders(outcome) };
  });

  registerRoute(scope, definitionApi.validateDraft, async (request) => {
    const validation = await validateOpenDraft(database, request.params.id);
    if (validation === undefined) {
      return notFoundProblem();
    }
    return { status: 200, body: validation };
  });

  registerRoute(scope, definitionApi.publishDraft, async (request) => {
    const precondition = draftPreconditionOf(request.headers["if-match"]);
    if ("status" in precondition) {
      return precondition;
    }
    const published = await publishDraft(database, {
      questionnaireId: request.params.id,
      precondition,
      actorId: authorOf(request),
      traceId: null,
    });
    if (published.outcome !== "published") {
      return definitionProblem(published);
    }
    return { status: 201, body: published.summary };
  });
}
