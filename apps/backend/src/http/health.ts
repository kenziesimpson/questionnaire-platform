import { problem } from "@qp/shared";
import { logger } from "@qp/telemetry";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { POOL_ROLES, type PoolRole } from "../config.js";
import type { Database } from "../db/client.js";
import { sendProblem } from "./problems.js";

const log = logger("http");

export const READINESS_CHECK_TIMEOUT_MS = 2_000;

export type ReadinessProbes = Readonly<Record<PoolRole, () => Promise<unknown>>>;

export function selectOne(database: Database): Promise<unknown> {
  // eslint-disable-next-line no-restricted-syntax -- a connectivity probe reads no table, so the query builder has nothing to select from
  return database.execute(sql`SELECT 1`);
}

function withinTimeout(probe: () => Promise<unknown>): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("readiness check timed out")), READINESS_CHECK_TIMEOUT_MS);
  });
  return Promise.race([probe(), expired]).finally(() => clearTimeout(timer));
}

async function failingPools(probes: ReadinessProbes): Promise<PoolRole[]> {
  const outcomes = await Promise.allSettled(POOL_ROLES.map((role) => withinTimeout(probes[role])));
  return POOL_ROLES.filter((role, index) => {
    const outcome = outcomes[index];
    if (outcome === undefined || outcome.status === "fulfilled") return false;
    log.warn("readiness check failed", { pool: role }, outcome.reason instanceof Error ? outcome.reason : undefined);
    return true;
  });
}

function alive(_request: unknown, reply: FastifyReply): { status: "ok" } {
  reply.header("cache-control", "no-store");
  return { status: "ok" };
}

export function registerHealthRoutes(app: FastifyInstance, probes: ReadinessProbes): void {
  app.get("/health", alive);
  app.get("/health/live", alive);
  app.get("/health/ready", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const failing = await failingPools(probes);
    if (failing.length > 0) {
      return sendProblem(reply, problem("service/unavailable", { detail: failing.join(", ") }));
    }
    return { status: "ok" };
  });
}
