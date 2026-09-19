import { PROBLEM_CONTENT_TYPE, problemType } from "@qp/shared";
import { installTestTelemetry } from "@qp/telemetry/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { requestLogger } from "../src/http/request-logger.js";
import { useTestDatabase } from "./db/fixtures.js";

const testDatabase = useTestDatabase();

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    definition: { database: testDatabase.database("definition") },
    execution: { database: testDatabase.database("execution") },
    reporting: { reporting: testDatabase.database("reporting") },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("buildApp", () => {
  it.each(["/health", "/health/live"])("serves the liveness check at %s", async (url) => {
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("serves the readiness check over all three real pools", async () => {
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("does not log a health probe as a request, and logs any other request", async () => {
    const telemetry = installTestTelemetry();
    const logged = await buildApp({
      logger: requestLogger("info"),
      definition: { database: testDatabase.database("definition") },
      execution: { database: testDatabase.database("execution") },
      reporting: { reporting: testDatabase.database("reporting") },
    });
    await logged.inject({ method: "GET", url: "/health/live" });
    await logged.inject({ method: "GET", url: "/health/ready" });
    await logged.inject({ method: "GET", url: "/health" });
    await logged.inject({ method: "GET", url: "/api/definition/questionnaires" });
    await logged.close();

    const routes = telemetry.logs().filter((line) => line.msg === "request completed").map((line) => line["http.route"]);
    await telemetry.shutdown();
    expect(routes).toEqual(["/api/definition/questionnaires"]);
  });

  it("trusts one proxy hop, so a request's address is the one nginx forwarded and not a value the client spoofed further left", async () => {
    const proxied = await buildApp({
      definition: { database: testDatabase.database("definition") },
      execution: { database: testDatabase.database("execution") },
      reporting: { reporting: testDatabase.database("reporting") },
    });
    proxied.get("/ip-probe", async (request) => request.ip);

    const forwarded = await proxied.inject({ method: "GET", url: "/ip-probe", remoteAddress: "10.0.0.1", headers: { "x-forwarded-for": "203.0.113.5" } });
    const spoofed = await proxied.inject({
      method: "GET",
      url: "/ip-probe",
      remoteAddress: "10.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.6" },
    });
    const direct = await proxied.inject({ method: "GET", url: "/ip-probe", remoteAddress: "10.0.0.1" });
    await proxied.close();

    expect([forwarded.body, spoofed.body, direct.body]).toEqual(["203.0.113.5", "203.0.113.6", "10.0.0.1"]);
  });

  it("mounts the telemetry ingest at /api/telemetry", async () => {
    const response = await app.inject({ method: "POST", url: "/api/telemetry", payload: { events: [] } });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 0, dropped: 0 });
  });

  it("mounts the definition module at /api/definition", async () => {
    const response = await app.inject({ method: "GET", url: "/api/definition/questionnaires" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("mounts the execution module at /api/run", async () => {
    const response = await app.inject({ method: "POST", url: "/api/run/sessions", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      type: problemType("request/invalid"),
      errors: [{ pointer: "/body/questionnaireId", code: "schema/required" }],
    });
  });

  it("mounts the reporting module at /api/reporting", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/reporting/questionnaires/00000000-0000-0000-0000-000000000000/responses",
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      type: problemType("resource/not-found"),
      instance: "/api/reporting/questionnaires/00000000-0000-0000-0000-000000000000/responses",
    });
  });

  it("answers an unknown path inside the execution module with a no-store problem body at the prefixed URL", async () => {
    const response = await app.inject({ method: "GET", url: "/api/run/questionnaires/current?q=1" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found"), instance: "/api/run/questionnaires/current?q=1" });
  });

  it("answers an unknown path inside the definition module with a problem body at the prefixed URL", async () => {
    const response = await app.inject({ method: "GET", url: "/api/definition/nowhere" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found"), instance: "/api/definition/nowhere" });
  });

  it("answers an unknown path outside any module with a problem body", async () => {
    const response = await app.inject({ method: "GET", url: "/api/nowhere" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found"), instance: "/api/nowhere" });
  });

  it.each(["/api/run/sessions/%zz", "/api/definition/questions/%zz?q=1", "/%zz"])(
    "answers the malformed URL %s with request/invalid at that URL, echoing nothing else",
    async (url) => {
      const response = await app.inject({ method: "GET", url });

      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
      expect(response.json()).toEqual({
        type: problemType("request/invalid"),
        title: expect.any(String),
        status: 400,
        instance: url,
        errors: [],
      });
    },
  );
});
