import { PROBLEM_CONTENT_TYPE, problemType } from "@qp/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
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
