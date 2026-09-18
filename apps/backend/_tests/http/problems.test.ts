import { PROBLEM_CONTENT_TYPE, problem, problemType, strict } from "@qp/shared";
import Fastify, { type FastifyInstance } from "fastify";
import Type from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyHttpDefaults, notFoundProblem, replyWithProblem, sendProblem } from "../../src/http/problems.js";

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
  it("answers unparseable JSON as request/invalid at the requested URL", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/things?draft=1",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("request/invalid"), instance: "/things?draft=1", errors: [] });
  });

  it("answers a schema failure as request/invalid at the requested URL", async () => {
    const response = await app.inject({ method: "POST", url: "/things", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      type: problemType("request/invalid"),
      instance: "/things",
      errors: [{ pointer: "/body/count", code: "schema/required" }],
    });
  });

  it("answers an unhandled error as internal at the requested URL, with the request id as detail and no message", async () => {
    const response = await app.inject({ method: "GET", url: "/explode" });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    const body = response.json();
    expect(body).toMatchObject({ type: problemType("internal"), status: 500, instance: "/explode" });
    expect(body.detail).toEqual(expect.any(String));
    expect(response.body).not.toContain("boom");
  });

  it("answers an unknown route as resource/not-found at the requested URL", async () => {
    const response = await app.inject({ method: "GET", url: "/nowhere?x=1" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toEqual({ ...notFoundProblem(), instance: "/nowhere?x=1" });
  });
});

describe("sendProblem", () => {
  it("sets instance to the request URL, replacing any instance the body carried", async () => {
    const scoped = Fastify();
    scoped.get("/here", async (_request, reply) => sendProblem(reply, problem("questionnaire/closed", { instance: "/elsewhere" })));

    const response = await scoped.inject({ method: "GET", url: "/here?x=1" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: problemType("questionnaire/closed"), instance: "/here?x=1" });
    await scoped.close();
  });
});

describe("notFoundProblem", () => {
  it("builds the one resource/not-found body, leaving the instance to sendProblem", () => {
    const body = notFoundProblem();

    expect(body).toMatchObject({ type: problemType("resource/not-found"), status: 404 });
    expect(body).not.toHaveProperty("instance");
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
