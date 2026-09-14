import { PROBLEM_CONTENT_TYPE, problemType } from "@qp/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { useTestDatabase } from "./db/harness.js";

const testDatabase = useTestDatabase();

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ definition: { database: testDatabase.database("definition") } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("buildApp", () => {
  it("serves the health check", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("mounts the definition module at /api/definition", async () => {
    const response = await app.inject({ method: "GET", url: "/api/definition/questionnaires" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("answers an unknown path outside any module with a problem body", async () => {
    const response = await app.inject({ method: "GET", url: "/api/nowhere" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found") });
  });
});
