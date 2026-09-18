import { definitionApi, snapshotEtag } from "@qp/shared";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../../db/client.js";
import { listVersionSummaries, readPublishedSnapshot } from "../../../db/definition/versions.js";
import { notFoundProblem } from "../../../http/problems.js";
import { registerRoute } from "../../../http/routes.js";

const IMMUTABLE_SNAPSHOT_CACHE_CONTROL = "private, max-age=31536000, immutable";

export function registerVersionRoutes(scope: FastifyInstance, database: Database): void {
  registerRoute(scope, definitionApi.listVersions, async (request) => {
    const versions = await listVersionSummaries(database, request.params.id);
    return versions === undefined ? notFoundProblem(request.url) : { status: 200, body: versions };
  });

  registerRoute(scope, definitionApi.getVersion, async (request) => {
    const snapshot = await readPublishedSnapshot(database, request.params.id, request.params.v);
    if (snapshot === undefined) {
      return notFoundProblem(request.url);
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
