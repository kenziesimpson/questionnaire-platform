import { definitionApi, formatDraftEtag, problem } from "@qp/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  openNextDraft,
  readDraft,
  replaceDraft,
  validateOpenDraft,
  type CurrentDraft,
} from "../../../db/definition/drafts.js";
import { registerRoute } from "../../../http/routes.js";
import { authorOf } from "../author.js";
import { draftPreconditionOf } from "../if-match.js";
import type { DefinitionModuleOptions } from "../plugin.js";

function draftHeaders({ draft, draftRevision }: CurrentDraft): Record<string, string> {
  return { etag: formatDraftEtag(draft.versionId, draftRevision), "cache-control": "no-store" };
}

function notFound(request: FastifyRequest) {
  return problem("resource/not-found", { instance: request.url });
}

export async function draftRoutes(scope: FastifyInstance, { database }: DefinitionModuleOptions): Promise<void> {
  registerRoute(scope, definitionApi.getDraft, async (request) => {
    const current = await readDraft(database, request.params.id);
    if (current === undefined) {
      return notFound(request);
    }
    return { status: 200, body: current.draft, headers: draftHeaders(current) };
  });

  registerRoute(scope, definitionApi.replaceDraft, async (request) => {
    const precondition = draftPreconditionOf(request.headers["if-match"]);
    const { title, items } = request.body;
    const outcome = await replaceDraft(database, {
      questionnaireId: request.params.id,
      precondition,
      title,
      items,
      actorId: authorOf(request),
      traceId: null,
    });
    switch (outcome.outcome) {
      case "saved":
        return { status: 200, body: outcome.draft, headers: draftHeaders(outcome) };
      case "stale":
        return problem("questionnaire/draft-stale", { instance: request.url });
      case "no-draft":
        return notFound(request);
      case "invalid":
        return problem("questionnaire/draft-invalid", { items: [...outcome.items] });
    }
  });

  registerRoute(scope, definitionApi.openDraft, async (request) => {
    const outcome = await openNextDraft(database, {
      questionnaireId: request.params.id,
      createdBy: authorOf(request),
      traceId: null,
    });
    switch (outcome.outcome) {
      case "opened":
        return { status: 201, body: outcome.draft, headers: draftHeaders(outcome) };
      case "draft-exists":
        return problem("questionnaire/draft-exists", { instance: request.url });
      case "questionnaire-not-found":
      case "nothing-published":
        return notFound(request);
    }
  });

  registerRoute(scope, definitionApi.validateDraft, async (request) => {
    const validation = await validateOpenDraft(database, request.params.id);
    if (validation === undefined) {
      return notFound(request);
    }
    return { status: 200, body: validation };
  });
}
