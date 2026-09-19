import { problem } from "@qp/shared";
import { logger } from "@qp/telemetry";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { POOL_ROLES, type PoolRole } from "../config.js";
import type { Database } from "../db/client.js";
import { withTimeout } from "../timeout.js";
import { sendProblem } from "./problems.js";

const log = logger("http");

const HEALTH_PATH = "/health";
const LIVE_PATH = `${HEALTH_PATH}/live`;
const READY_PATH = `${HEALTH_PATH}/ready`;

export const READINESS_CHECK_TIMEOUT_MS = 2_000;

export function isHealthRequest(url: string): boolean {
  return url === HEALTH_PATH || url.startsWith(`${HEALTH_PATH}/`) || url.startsWith(`${HEALTH_PATH}?`);
}

export type ReadinessProbes = Readonly<Record<PoolRole, () => Promise<unknown>>>;

export function selectOne(database: Database): Promise<unknown> {
  // eslint-disable-next-line no-restricted-syntax -- a connectivity probe reads no table, so the query builder has nothing to select from
  return database.execute(sql`SELECT 1`);
}

function singleFlight(probes: ReadinessProbes): (role: PoolRole) => Promise<unknown> {
  const inFlight = new Map<PoolRole, Promise<unknown>>();
  return (role) => {
    const running = inFlight.get(role);
    if (running !== undefined) return running;
    const started = (async () => probes[role]())().finally(() => inFlight.delete(role));
    inFlight.set(role, started);
    return started;
  };
}

function failingPoolsOf(probe: (role: PoolRole) => Promise<unknown>): () => Promise<PoolRole[]> {
  return async () => {
    const outcomes = await Promise.allSettled(POOL_ROLES.map((role) => withTimeout(probe(role), READINESS_CHECK_TIMEOUT_MS)));
    return POOL_ROLES.filter((role, index) => {
      const outcome = outcomes[index];
      if (outcome === undefined || outcome.status === "fulfilled") return false;
      log.warn("readiness check failed", { pool: role }, outcome.reason instanceof Error ? outcome.reason : undefined);
      return true;
    });
  };
}

function alive(_request: unknown, reply: FastifyReply): { status: "ok" } {
  reply.header("cache-control", "no-store");
  return { status: "ok" };
}

export function registerHealthRoutes(app: FastifyInstance, probes: ReadinessProbes): void {
  const failingPools = failingPoolsOf(singleFlight(probes));
  app.get(HEALTH_PATH, alive);
  app.get(LIVE_PATH, alive);
  app.get(READY_PATH, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const failing = await failingPools();
    if (failing.length > 0) {
      return sendProblem(reply, problem("service/unavailable", { detail: failing.join(", ") }));
    }
    return { status: "ok" };
  });
}
