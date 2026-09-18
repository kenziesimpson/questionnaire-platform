import { PositiveInt, problemType, strict } from "@qp/shared";
import Fastify, { type FastifyInstance } from "fastify";
import Type from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replyWithProblem } from "../../src/http/problems.js";
import { requestValidatorCompiler } from "../../src/http/validation.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(requestValidatorCompiler());
  app.setErrorHandler(replyWithProblem);
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
