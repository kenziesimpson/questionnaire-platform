import { setTimeout as delay } from "node:timers/promises";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import pg from "pg";
import type { StackEndpoints } from "./stack-endpoints.ts";

const READINESS_TIMEOUT_MS = 180_000;
const READINESS_POLL_INTERVAL_MS = 500;

interface ReadinessProbe {
  readonly description: string;
  readonly check: (endpoints: StackEndpoints) => Promise<boolean>;
}

async function respondsWith(url: string, accept: (response: Response) => boolean): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    await response.arrayBuffer();
    return accept(response);
  } catch {
    return false;
  }
}

function isHtml(response: Response): boolean {
  return response.status === 200 && (response.headers.get("content-type") ?? "").includes("text/html");
}

async function databaseAcceptsQueries(databaseUrl: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const PROBES: readonly ReadinessProbe[] = [
  {
    description: "Postgres accepts queries on the mapped port",
    check: ({ databaseUrl }) => databaseAcceptsQueries(databaseUrl),
  },
  {
    description: "the backend serves the seeded demo's version history through the nginx /api proxy",
    check: ({ baseUrl }) =>
      respondsWith(`${baseUrl}/api/definition/questionnaires/${INTAKE_QUESTIONNAIRE_ID}/versions`, (response) => response.status === 200),
  },
  {
    description: "nginx serves the respondent app at /q/:id",
    check: ({ baseUrl }) => respondsWith(`${baseUrl}/q/${INTAKE_QUESTIONNAIRE_ID}`, isHtml),
  },
  {
    description: "nginx serves the admin app at /admin/",
    check: ({ baseUrl }) => respondsWith(`${baseUrl}/admin/`, isHtml),
  },
];

async function failingProbes(endpoints: StackEndpoints): Promise<ReadinessProbe[]> {
  const results = await Promise.all(PROBES.map(async (probe) => ({ probe, ready: await probe.check(endpoints) })));
  return results.filter(({ ready }) => !ready).map(({ probe }) => probe);
}

export async function waitForStackReady(endpoints: StackEndpoints, timeoutMs: number = READINESS_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let failing = await failingProbes(endpoints);
  while (failing.length > 0) {
    if (Date.now() > deadline) {
      const reasons = failing.map((probe) => `  - ${probe.description}`).join("\n");
      throw new Error(`The stack at ${endpoints.baseUrl} was not ready after ${timeoutMs} ms. Still failing:\n${reasons}`);
    }
    await delay(READINESS_POLL_INTERVAL_MS);
    failing = await failingProbes(endpoints);
  }
}
