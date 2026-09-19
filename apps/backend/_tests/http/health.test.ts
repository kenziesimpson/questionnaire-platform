import { PROBLEM_CONTENT_TYPE, problemType } from "@qp/shared";
import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POOL_ROLES } from "../../src/config.js";
import { applyHttpDefaults, replyWithProblem } from "../../src/http/problems.js";
import { READINESS_CHECK_TIMEOUT_MS, registerHealthRoutes, type ReadinessProbes } from "../../src/http/health.js";

const CANARY = "CANARY_DIABETES_8F3A";

let telemetry: TestTelemetry;
let app: FastifyInstance | undefined;

const healthy = async () => 1;

function probes(overrides: Partial<Record<(typeof POOL_ROLES)[number], () => Promise<unknown>>> = {}): ReadinessProbes {
  return { definition: healthy, execution: healthy, reporting: healthy, ...overrides };
}

async function appWith(readiness: ReadinessProbes): Promise<FastifyInstance> {
  const built = Fastify();
  applyHttpDefaults(built, replyWithProblem);
  registerHealthRoutes(built, readiness);
  await built.ready();
  app = built;
  return built;
}

beforeEach(() => {
  telemetry = installTestTelemetry();
});

afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = undefined;
  await telemetry.shutdown();
});

describe("/health/live", () => {
  it.each(["/health/live", "/health"])("answers 200 ok on %s without touching a pool", async (url) => {
    const probe = vi.fn(healthy);
    const built = await appWith(probes({ definition: probe, execution: probe, reporting: probe }));

    const response = await built.inject({ method: "GET", url });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(probe).not.toHaveBeenCalled();
  });

  it("stays 200 while every pool is failing", async () => {
    const failing = async () => {
      throw new Error("down");
    };
    const built = await appWith(probes({ definition: failing, execution: failing, reporting: failing }));

    expect((await built.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
  });
});

describe("/health/ready", () => {
  it("probes all three pools and answers 200 ok when each answers", async () => {
    const definition = vi.fn(healthy);
    const execution = vi.fn(healthy);
    const reporting = vi.fn(healthy);
    const built = await appWith({ definition, execution, reporting });

    const response = await built.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect([definition, execution, reporting].map((probe) => probe.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("answers 503 with a problem naming each failing pool by role and nothing else", async () => {
    const built = await appWith(
      probes({
        definition: async () => {
          throw new Error(`connect ECONNREFUSED ${CANARY}`);
        },
        reporting: async () => {
          throw new Error(`password authentication failed for user "${CANARY}"`);
        },
      }),
    );

    const response = await built.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      type: problemType("service/unavailable"),
      title: "The service is not ready to accept requests",
      status: 503,
      detail: "definition, reporting",
      instance: "/health/ready",
    });
    expect(response.body).not.toContain(CANARY);
  });

  it("logs each failing pool by role and never the error message", async () => {
    const built = await appWith(
      probes({
        execution: async () => {
          throw new Error(`connect ECONNREFUSED ${CANARY}`);
        },
      }),
    );

    await built.inject({ method: "GET", url: "/health/ready" });

    const warning = telemetry.logs().find((line) => line.msg === "readiness check failed");
    expect(warning).toMatchObject({ level: "warn", "db.pool": "execution", "error.type": "Error" });
    expect(JSON.stringify(telemetry.logs())).not.toContain(CANARY);
  });

  it("counts a pool that does not answer in time as failing", async () => {
    vi.useFakeTimers();
    const built = await appWith(probes({ execution: () => new Promise<never>(() => undefined) }));

    const pending = built.inject({ method: "GET", url: "/health/ready" });
    await vi.advanceTimersByTimeAsync(READINESS_CHECK_TIMEOUT_MS);
    const response = await pending;

    expect(response.statusCode).toBe(503);
    expect(response.json().detail).toBe("execution");
  });

  it("reuses a probe still in flight instead of queueing another behind a hung pool, and probes again once it settles", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const hung = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockImplementation(healthy);
    const built = await appWith(probes({ execution: hung }));

    for (let request = 0; request < 3; request++) {
      const pending = built.inject({ method: "GET", url: "/health/ready" });
      await vi.advanceTimersByTimeAsync(READINESS_CHECK_TIMEOUT_MS);
      expect((await pending).statusCode).toBe(503);
    }
    expect(hung).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    const settled = built.inject({ method: "GET", url: "/health/ready" });
    await vi.advanceTimersByTimeAsync(0);
    expect((await settled).statusCode).toBe(200);
    expect(hung).toHaveBeenCalledTimes(2);
  });
});
