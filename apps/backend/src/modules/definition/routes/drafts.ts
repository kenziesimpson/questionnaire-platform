import {
  definitionApi,
  formatDraftEtag,
  problem,
  type DraftItem,
  type DraftItemCode,
  type ItemError,
  type ReplyOf,
} from "@qp/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createQuestionnaire,
  openNextDraft,
  readDraft,
  replaceDraft,
  validateOpenDraft,
  type CurrentDraft,
} from "../../../db/definition/questionnaires.js";
import { registerRoute } from "../../../http/routes.js";
import { authorOf } from "../author.js";
import { draftPreconditionOf } from "../if-match.js";
import type { DefinitionModuleOptions } from "../plugin.js";

type DraftValidationBody = ReplyOf<typeof definitionApi.validateDraft, 200>;

function draftHeaders({ draft, draftRevision }: CurrentDraft): Record<string, string> {
  return { etag: formatDraftEtag(draft.versionId, draftRevision), "cache-control": "no-store" };
}

function notFound(request: FastifyRequest) {
  return problem("resource/not-found", { instance: request.url });
}

function offendingItems(
  items: readonly DraftItem[],
  isOffending: (item: DraftItem) => boolean,
  code: DraftItemCode,
): ItemError<DraftItemCode>[] {
  return items.filter(isOffending).map((item) => ({ itemId: item.itemId, code }));
}

export async function draftRoutes(scope: FastifyInstance, { database }: DefinitionModuleOptions): Promise<void> {
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
      expectedDraftVersionId: precondition.versionId,
      expectedDraftRevision: precondition.draftRevision,
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
      case "duplicate-item-id":
        return problem("questionnaire/draft-invalid", {
          items: outcome.itemIds.map((itemId) => ({ itemId, code: "draft/duplicate-item-id" })),
        });
      case "archived-question": {
        const archived = new Set(outcome.questionIds);
        return problem("questionnaire/draft-invalid", {
          items: offendingItems(items, (item) => archived.has(item.questionId), "draft/question-archived"),
        });
      }
      case "unknown-question-version": {
        const unknown = new Set(outcome.itemIds);
        return problem("questionnaire/draft-invalid", {
          items: offendingItems(items, (item) => unknown.has(item.itemId), "draft/question-version-unknown"),
        });
      }
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
    return { status: 200, body: validation as DraftValidationBody };
  });
}
