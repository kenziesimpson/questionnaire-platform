import { PROBLEM_CONTENT_TYPE, PositiveInt, Uuid, defineRoute, problem, problemType } from "@qp/shared";
import Fastify, { type FastifyInstance } from "fastify";
import Type from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replyWithProblem, requestValidatorCompiler } from "../../src/http/problems.js";
import { registerRoute, type RouteHandler } from "../../src/http/routes.js";

const strict = { additionalProperties: false } as const;
const Widget = Type.Object({ widgetId: Uuid, size: PositiveInt }, strict);

const getWidget = defineRoute({
  method: "GET",
  url: "/widgets/:widgetId",
  schema: {
    params: Type.Object({ widgetId: Uuid }, strict),
    querystring: Type.Object({ size: Type.Optional(PositiveInt) }, strict),
    response: { 200: Widget },
  },
});

const createWidget = defineRoute({
  method: "POST",
  url: "/widgets",
  schema: {
    headers: Type.Object({ "if-match": Type.String({ minLength: 1 }) }),
    body: Type.Object({ size: PositiveInt }, strict),
    response: { 201: Widget },
  },
});

const MISSING_WIDGET = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";
const NEW_WIDGET = "01a0950e-56a0-73d6-b936-4a1e10eff8c1";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(requestValidatorCompiler());
  app.setErrorHandler(replyWithProblem);

  registerRoute(app, getWidget, async (request) =>
    request.params.widgetId === MISSING_WIDGET
      ? problem("resource/not-found", { instance: request.url })
      : { status: 200, body: { widgetId: request.params.widgetId, size: request.query.size ?? 1 } },
  );

  registerRoute(app, createWidget, async (request) => ({
    status: 201,
    body: { widgetId: NEW_WIDGET, size: request.body.size },
    headers: { etag: request.headers["if-match"] },
  }));

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("registerRoute", () => {
  it("registers the shared route's method, URL and schema, with typed params and query", async () => {
    const response = await app.inject({ method: "GET", url: `/widgets/${NEW_WIDGET}?size=3` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ widgetId: NEW_WIDGET, size: 3 });
  });

  it("validates against the shared schema before the handler runs", async () => {
    const response = await app.inject({ method: "GET", url: "/widgets/not-a-uuid" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ pointer: "/params/widgetId", code: "schema/format" }] });
  });

  it("sends the status and headers the handler returns", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/widgets",
      headers: { "if-match": 'W/"abc"' },
      payload: { size: 2 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('W/"abc"');
    expect(response.json()).toEqual({ widgetId: NEW_WIDGET, size: 2 });
  });

  it("sends a returned problem as application/problem+json with its status", async () => {
    const response = await app.inject({ method: "GET", url: `/widgets/${MISSING_WIDGET}` });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found"), instance: `/widgets/${MISSING_WIDGET}` });
  });

  it("serializes through the response schema, dropping fields it does not declare", async () => {
    const leaky = defineRoute({ method: "GET", url: "/leaky", schema: { response: { 200: Widget } } });
    const scoped = Fastify();
    registerRoute(scoped, leaky, async () => ({
      status: 200,
      body: { widgetId: NEW_WIDGET, size: 1, secret: "x" } as { widgetId: string; size: number },
    }));

    const response = await scoped.inject({ method: "GET", url: "/leaky" });

    expect(response.json()).toEqual({ widgetId: NEW_WIDGET, size: 1 });
    await scoped.close();
  });
});

describe("RouteHandler types", () => {
  it("ties the status, body and request parts to the shared route", () => {
    // @ts-expect-error — createWidget declares only 201 as a success status
    const wrongStatus: RouteHandler<typeof createWidget> = async (request) => ({
      status: 200,
      body: { widgetId: NEW_WIDGET, size: request.body.size },
    });

    // @ts-expect-error — size must be a number, as Widget declares
    const wrongBody: RouteHandler<typeof getWidget> = async () => ({
      status: 200,
      body: { widgetId: NEW_WIDGET, size: "large" },
    });

    const undeclaredParam: RouteHandler<typeof getWidget> = async (request) => ({
      status: 200,
      // @ts-expect-error — getWidget's params declare widgetId only
      body: { widgetId: request.params.id, size: 1 },
    });

    const bodyOnGet: RouteHandler<typeof getWidget> = async (request) => {
      // @ts-expect-error — getWidget declares no body, so it is unknown
      const size: number = request.body.size;
      return { status: 200, body: { widgetId: NEW_WIDGET, size } };
    };

    const problemOnAnyRoute: RouteHandler<typeof createWidget> = async () =>
      problem("questionnaire/draft-stale", { instance: "/widgets" });

    expect([wrongStatus, wrongBody, undeclaredParam, bodyOnGet, problemOnAnyRoute]).toHaveLength(5);
  });
});
