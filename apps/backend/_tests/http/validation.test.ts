import { IsoDateTime, PositiveInt, Uuid, problemType, strict } from "@qp/shared";
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
  app.put<{ Body: { closesAt: string; note?: string } }>(
    "/moments",
    { schema: { body: Type.Object({ closesAt: IsoDateTime, note: Type.Optional(Type.String()) }, strict) } },
    async (request) => ({ closesAt: request.body.closesAt }),
  );
  app.get<{ Params: { id: string } }>("/records/:id", { schema: { params: Type.Object({ id: Uuid }, strict) } }, async (request) => ({ id: request.params.id }));
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

  it("refuses a path or query integer above the int4 maximum with the maximum keyword, and accepts the maximum", async () => {
    const above = await postThing("/things/2147483648", { count: 1 });
    const at = await postThing("/things/2147483647", { count: 1 });

    expect(above.statusCode).toBe(400);
    expect(above.json().errors).toEqual([{ pointer: "/params/v", code: "schema/maximum" }]);
    expect(at.statusCode).toBe(200);
  });

  it.each([
    ["a year of 0000", "0000-01-01T00:00:00Z"],
    ["a day the month does not have", "2023-02-30T00:00:00Z"],
    ["a month of 13", "2023-13-01T00:00:00Z"],
    ["a leap second, which a JavaScript Date cannot hold", "2026-01-01T23:59:60Z"],
    ["a lower-case separator", "2026-01-01t00:00:00z"],
    ["a space separator", "2026-01-01 00:00:00Z"],
    ["an offset without a colon", "2026-01-01T00:00:00+0100"],
    ["a year of five digits", "10000-01-01T00:00:00Z"],
    ["no offset", "2026-01-01T00:00:00"],
  ])("refuses a timestamp with %s as a schema failure, and never returns the value", async (_name, closesAt) => {
    const response = await app.inject({ method: "PUT", url: "/moments", payload: { closesAt } });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toEqual(expect.arrayContaining([expect.objectContaining({ pointer: "/body/closesAt" })]));
    expect(response.body).not.toContain(closesAt);
  });

  it.each(["2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00Z", "0001-01-01T00:00:00Z", "9999-12-31T23:59:59.999Z", "2026-10-01T00:00:00+05:30"])(
    "accepts the timestamp %s, which a Date holds",
    async (closesAt) => {
      const response = await app.inject({ method: "PUT", url: "/moments", payload: { closesAt } });

      expect(response.statusCode).toBe(200);
      expect(Number.isNaN(new Date(closesAt).getTime())).toBe(false);
    },
  );

  it("refuses a null character in a body string, naming the string and not its content", async () => {
    const response = await app.inject({ method: "PUT", url: "/moments", payload: { closesAt: "2026-10-01T00:00:00Z", note: "before" + String.fromCharCode(0) + "LEAK_AFTER" } });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toEqual([{ pointer: "/body/note", code: "schema/pattern" }]);
    expect(response.body).not.toContain("LEAK_AFTER");
  });

  it("refuses a null character in a body key, naming the object that holds it", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/moments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ closesAt: "2026-10-01T00:00:00Z", ["LEAK_KEY" + String.fromCharCode(0)]: true }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toEqual([{ pointer: "/body", code: "schema/pattern" }]);
    expect(response.body).not.toContain("LEAK_KEY");
  });

  describe("a request the schema refuses is still refused with the null-character check in front of the validator", () => {
    it("answers a path parameter that is not a uuid with 400 and does not reach the handler", async () => {
      const response = await app.inject({ method: "GET", url: "/records/not-a-uuid" });

      expect(response.statusCode).toBe(400);
      expect(response.json().errors).toEqual([{ pointer: "/params/id", code: "schema/format" }]);
    });

    it("answers an integer over its maximum with 400", async () => {
      const response = await postThing("/things/2147483648", { count: 1 });

      expect(response.statusCode).toBe(400);
    });

    it("answers an additional body property with 400", async () => {
      const response = await postThing("/things/2", { count: 1, extra: true });

      expect(response.statusCode).toBe(400);
    });

    it("answers a null character with 400", async () => {
      const response = await app.inject({ method: "PUT", url: "/moments", payload: { closesAt: "2026-10-01T00:00:00Z", note: "a" + String.fromCharCode(0) } });

      expect(response.statusCode).toBe(400);
    });

    it("still answers a valid request with 200", async () => {
      const response = await app.inject({ method: "GET", url: "/records/0f8fad5b-d9cb-469f-a165-70867728950e" });

      expect(response.statusCode).toBe(200);
    });
  });
});
