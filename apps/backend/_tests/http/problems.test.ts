import { PROBLEM_CONTENT_TYPE, PositiveInt, problemType } from "@qp/shared";
import Fastify, { type FastifyInstance } from "fastify";
import Type from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replyNotFound, replyWithProblem, requestValidatorCompiler } from "../../src/http/problems.js";

const strict = { additionalProperties: false } as const;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(requestValidatorCompiler());
  app.setErrorHandler(replyWithProblem);
  app.setNotFoundHandler(replyNotFound);
  app.post<{ Params: { v: number }; Querystring: { flag?: boolean }; Body: { count: number } }>(
    "/things/:v",
    {
      schema: {
        params: Type.Object({ v: PositiveInt }, strict),
        querystring: Type.Object({ flag: Type.Optional(Type.Boolean()) }, strict),
        body: Type.Object({ count: Type.Integer() }, strict),
      },
    },
    async (request) => ({ v: request.params.v, flag: request.query.flag, count: request.body.count }),
  );
  app.get("/explode", async () => {
    throw new Error("boom");
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function postThing(url: string, payload: unknown) {
  return app.inject({ method: "POST", url, payload: payload as Record<string, unknown> });
}

describe("requestValidatorCompiler", () => {
  it("coerces path and query strings to their schema types", async () => {
    const response = await postThing("/things/2?flag=true", { count: 1 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ v: 2, flag: true, count: 1 });
  });

  it("does not coerce the body: a numeric string is a type failure", async () => {
    const response = await postThing("/things/2", { count: "1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      type: problemType("request/invalid"),
      errors: [{ pointer: "/body/count", code: "schema/type" }],
    });
  });

  it("rejects an additional body property rather than stripping it", async () => {
    const response = await postThing("/things/2", { count: 1, extra: true });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toEqual([{ pointer: "/body/extra", code: "schema/additionalProperties" }]);
  });

  it("names a missing property in the pointer", async () => {
    const response = await postThing("/things/2", {});

    expect(response.json().errors).toEqual([{ pointer: "/body/count", code: "schema/required" }]);
  });

  it("points into params for a path segment out of range", async () => {
    const response = await postThing("/things/0", { count: 1 });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toEqual([{ pointer: "/params/v", code: "schema/minimum" }]);
  });
});

describe("replyWithProblem", () => {
  it("answers unparseable JSON as request/invalid", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/things/2",
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

  it("answers an unknown route as resource/not-found", async () => {
    const response = await app.inject({ method: "GET", url: "/nowhere" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found"), instance: "/nowhere" });
  });
});
