import rateLimit from "@fastify/rate-limit";
import { problem, telemetryApi } from "@qp/shared";
import { createIngestCapacity, ingestBatch, withSpan } from "@qp/telemetry";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { applyHttpDefaults, replyWithProblem, sendProblem } from "../../http/problems.js";
import { registerRoute } from "../../http/routes.js";

export interface TelemetryModuleOptions {
  readonly rateLimit?: { readonly max: number; readonly windowMs: number };
  readonly eventsPerSecond?: number;
  readonly now?: () => number;
}

const DEFAULT_RATE_LIMIT: NonNullable<TelemetryModuleOptions["rateLimit"]> = { max: telemetryApi.MAX_TELEMETRY_REQUESTS_PER_MINUTE, windowMs: 60_000 };

const IPV6_SUBNET_BITS = 64;

const TRACKED_ADDRESSES = 10_000;

const NO_HEADERS = { "x-ratelimit-limit": false, "x-ratelimit-remaining": false, "x-ratelimit-reset": false, "retry-after": false };

class RateLimited extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterMs: number) {
    super("rate limited");
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  }
}

function replyWithTelemetryProblem(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (!(error instanceof RateLimited)) return replyWithProblem(error, request, reply);
  reply.header("retry-after", String(error.retryAfterSeconds));
  return sendProblem(reply, problem("request/rate-limited"));
}

export async function telemetryModule(
  scope: FastifyInstance,
  { rateLimit: perAddress = DEFAULT_RATE_LIMIT, eventsPerSecond, now = Date.now }: TelemetryModuleOptions,
): Promise<void> {
  const ingestCapacity = createIngestCapacity(eventsPerSecond);

  applyHttpDefaults(scope, replyWithTelemetryProblem);
  await scope.register(rateLimit, {
    global: false,
    max: perAddress.max,
    timeWindow: perAddress.windowMs,
    ipv6Subnet: IPV6_SUBNET_BITS,
    cache: TRACKED_ADDRESSES,
    addHeaders: NO_HEADERS,
    addHeadersOnExceeding: NO_HEADERS,
    errorResponseBuilder: (_request, context) => new RateLimited(context.ttl),
  });
  const limitAddress = scope.rateLimit();
  async function limitRate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await limitAddress.call(scope, request, reply);
  }
  scope.addHook("onRequest", limitRate);
  scope.addHook("onSend", async function noStore(_request, reply) {
    reply.header("cache-control", "no-store");
  });

  registerRoute(
    scope,
    telemetryApi.ingestEvents,
    async (request) => {
      const receipt = await withSpan("telemetry.ingest", {}, async () => ingestBatch(request.body.events, now(), ingestCapacity));
      return { status: 202, body: receipt };
    },
    { bodyLimit: telemetryApi.MAX_TELEMETRY_BODY_BYTES },
  );
}
