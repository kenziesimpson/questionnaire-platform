import { problem, telemetryApi } from "@qp/shared";
import { ingestBatch, withSpan } from "@qp/telemetry";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { applyHttpDefaults, replyWithProblem, sendProblem } from "../../http/problems.js";
import { registerRoute } from "../../http/routes.js";
import { RateLimiter, type RateLimit } from "./rate-limit.js";

export interface TelemetryModuleOptions {
  readonly rateLimit?: RateLimit;
  readonly now?: () => number;
}

const DEFAULT_RATE_LIMIT: RateLimit = { max: 300, windowMs: 60_000 };

export async function telemetryModule(
  scope: FastifyInstance,
  { rateLimit = DEFAULT_RATE_LIMIT, now = Date.now }: TelemetryModuleOptions,
): Promise<void> {
  const limiter = new RateLimiter(rateLimit, now);

  async function limitRate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    const verdict = limiter.admit(request.ip);
    if (verdict.allowed) return undefined;
    reply.header("retry-after", String(verdict.retryAfterSeconds));
    return sendProblem(reply, problem("request/rate-limited"));
  }

  applyHttpDefaults(scope, replyWithProblem);
  scope.addHook("onRequest", limitRate);
  scope.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  registerRoute(
    scope,
    telemetryApi.ingestEvents,
    async (request) => {
      const receipt = await withSpan("telemetry.ingest", {}, async () => ingestBatch(request.body.events, now()));
      return { status: 202, body: receipt };
    },
    { bodyLimit: telemetryApi.MAX_TELEMETRY_BODY_BYTES },
  );
}
