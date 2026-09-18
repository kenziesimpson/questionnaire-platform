import { definitionApi, problem, snapshotEtag, type Problem } from "@qp/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { publishDraft } from "../../../db/definition/publish.js";
import { listVersionSummaries, readPublishedSnapshot } from "../../../db/definition/versions.js";
import { registerRoute } from "../../../http/routes.js";
import { authorOf } from "../author.js";
import { draftPreconditionOf } from "../if-match.js";
import type { DefinitionModuleOptions } from "../plugin.js";

const IMMUTABLE_SNAPSHOT_CACHE_CONTROL = "private, max-age=31536000, immutable";

function notFound(request: FastifyRequest): Problem {
  return problem("resource/not-found", { instance: request.url });
}

export async function versionRoutes(scope: FastifyInstance, { database }: DefinitionModuleOptions): Promise<void> {
  registerRoute(scope, definitionApi.publishDraft, async (request) => {
    const precondition = draftPreconditionOf(request.headers["if-match"]);
    const published = await publishDraft(database, {
      questionnaireId: request.params.id,
      precondition,
      actorId: authorOf(request),
      traceId: null,
    });
    switch (published.outcome) {
      case "questionnaire-not-found":
      case "no-draft":
        return notFound(request);
      case "stale":
        return problem("questionnaire/draft-stale", { instance: request.url });
      case "invalid":
        return problem("questionnaire/draft-invalid", { instance: request.url, items: [...published.items] });
      case "published":
        return { status: 201, body: published.summary };
    }
  });

  registerRoute(scope, definitionApi.listVersions, async (request) => {
    const versions = await listVersionSummaries(database, request.params.id);
    return versions === undefined ? notFound(request) : { status: 200, body: versions };
  });

  registerRoute(scope, definitionApi.getVersion, async (request) => {
    const snapshot = await readPublishedSnapshot(database, request.params.id, request.params.v);
    if (snapshot === undefined) {
      return notFound(request);
    }
    return {
      status: 200,
      body: snapshot.definition,
      headers: {
        etag: snapshotEtag(request.params.id, request.params.v, snapshot.formatVersion),
        "cache-control": IMMUTABLE_SNAPSHOT_CACHE_CONTROL,
      },
    };
  });
}
