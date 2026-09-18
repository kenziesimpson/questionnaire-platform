import { PROBLEM_CONTENT_TYPE, problemType, strict } from "@qp/shared";
import Fastify, { type FastifyInstance } from "fastify";
import Type from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyHttpDefaults, notFoundProblem, replyWithProblem } from "../../src/http/problems.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  applyHttpDefaults(app, replyWithProblem);
  app.post<{ Body: { count: number } }>(
    "/things",
    { schema: { body: Type.Object({ count: Type.Integer() }, strict) } },
    async (request) => ({ count: request.body.count }),
  );
  app.get("/explode", async () => {
    throw new Error("boom");
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("replyWithProblem", () => {
  it("answers unparseable JSON as request/invalid", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/things",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("request/invalid"), errors: [] });
  });

  it("answers an unhandled error as internal, with the request id as detail and no message", async () => {
    const response = await app.inject({ method: "GET", url: "/explode" });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    const body = response.json();
    expect(body).toMatchObject({ type: problemType("internal"), status: 500 });
    expect(body.detail).toEqual(expect.any(String));
    expect(response.body).not.toContain("boom");
  });

  it("answers an unknown route as resource/not-found at the requested URL", async () => {
    const response = await app.inject({ method: "GET", url: "/nowhere?x=1" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toEqual(notFoundProblem("/nowhere?x=1"));
  });
});

describe("notFoundProblem", () => {
  it("builds the one resource/not-found body, at the instance it is given", () => {
    expect(notFoundProblem("/x")).toMatchObject({ type: problemType("resource/not-found"), status: 404, instance: "/x" });
  });
});

describe("applyHttpDefaults", () => {
  it("installs the exact request validator, so a body is not coerced", async () => {
    const response = await app.inject({ method: "POST", url: "/things", payload: { count: "1" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ pointer: "/body/count", code: "schema/type" }] });
  });

  it("installs the error handler it is given", async () => {
    const scoped = Fastify();
    applyHttpDefaults(scoped, (_error, _request, reply) => reply.code(418).send({ handled: true }));
    scoped.get("/explode", async () => {
      throw new Error("boom");
    });

    const response = await scoped.inject({ method: "GET", url: "/explode" });

    expect(response.statusCode).toBe(418);
    expect(response.json()).toEqual({ handled: true });
    await scoped.close();
  });
});
