import { PROBLEM_CONTENT_TYPE, problem, problemType, strict } from "@qp/shared";
import { withSpan } from "@qp/telemetry";
import { startTelemetry, type TelemetryHandle } from "@qp/telemetry/node";
import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DrizzleQueryError } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import Type from "typebox";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SQLSTATE } from "../../src/db/errors.js";
import { applyHttpDefaults, notFoundProblem, replyWithProblem, sendProblem } from "../../src/http/problems.js";
import { InvariantViolation } from "../../src/invariant.js";

const CANARY = "CANARY_DIABETES_8F3A";
const TRACE_ID = /^[0-9a-f]{32}$/;

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

describe("the 500 problem and its telemetry", () => {
  let telemetry: TestTelemetry;
  let scoped: FastifyInstance;

  beforeEach(async () => {
    telemetry = installTestTelemetry();
    scoped = Fastify();
    applyHttpDefaults(scoped, replyWithProblem);
    scoped.get("/plain/:sessionId", async () => {
      throw new TypeError(`bad value ${CANARY}`);
    });
    scoped.get("/database", async () => {
      throw Object.assign(new Error(`duplicate key value violates unique constraint, Key (answer)=(${CANARY})`), {
        code: SQLSTATE.uniqueViolation,
        constraint: "response_pkey",
        detail: `Key (answer)=(${CANARY}) already exists.`,
      });
    });
    scoped.get("/multiline", async () => {
      throw new Error(`line1\n    at ${CANARY} (secret.txt:1:1)`);
    });
    scoped.get("/drizzle", async () => {
      const cause = Object.assign(new Error("duplicate"), { code: SQLSTATE.uniqueViolation, constraint: "response_pkey" });
      throw new DrizzleQueryError("insert into response (text_value) values (?)", [`x\n    at ${CANARY} (secret.txt:1:1)`], cause);
    });
    scoped.get("/invariant", async () => {
      throw InvariantViolation.of("session.not-marked-submitted", { sessionId: "s-1", questionnaireVersion: 2 });
    });
    scoped.post<{ Body: { count: number } }>(
      "/things",
      { schema: { body: Type.Object({ count: Type.Integer() }, strict) } },
      async (request) => ({ count: request.body.count }),
    );
    scoped.get("/closed/:sessionId", async (_request, reply) =>
      sendProblem(reply, { ...problem("questionnaire/closed"), title: `title ${CANARY}`, detail: `detail ${CANARY}` }),
    );
    await scoped.ready();
  });

  afterEach(async () => {
    await scoped.close();
    await telemetry.shutdown();
  });

  async function everythingEmitted(): Promise<string> {
    return JSON.stringify([telemetry.logs(), telemetry.spans().map((span) => span.attributes), await telemetry.metrics()]);
  }

  it("sets detail to the active trace id and never the error message", async () => {
    const response = await withSpan("session.submit", {}, async () => scoped.inject({ method: "GET", url: "/plain/x" }));

    const body = response.json();
    expect(response.statusCode).toBe(500);
    expect(body.detail).toMatch(TRACE_ID);
    expect(body.detail).toBe(telemetry.spans()[0]?.spanContext().traceId);
    expect(response.body).not.toContain(CANARY);
    expect(body.title).toBe("Internal error");
  });

  it("falls back to the request id when no span is active", async () => {
    const response = await scoped.inject({ method: "GET", url: "/plain/x" });

    expect(response.json().detail).toBe("req-1");
  });

  it("logs the error type, its stack frames and the route, and never the message or the URL", async () => {
    await scoped.inject({ method: "GET", url: `/plain/${CANARY}?token=${CANARY}` });

    const failure = telemetry.logs().find((line) => line.msg === "unhandled request error");
    expect(failure).toMatchObject({
      level: "error",
      module: "http",
      "error.type": "TypeError",
      "http.request.id": "req-1",
      "http.route": "/plain/:sessionId",
    });
    expect(failure?.["error.stack"]).toEqual(expect.stringMatching(/^ {4}at /));
    expect(String(failure?.["error.stack"]).split("\n")[0]).not.toContain("TypeError");
    expect(await everythingEmitted()).not.toContain(CANARY);
  });

  it.each(["/multiline", "/drizzle"])("logs no fragment of a multi-line message that imitates a stack frame (%s)", async (url) => {
    const response = await scoped.inject({ method: "GET", url });

    expect(response.statusCode).toBe(500);
    const failure = telemetry.logs().find((line) => line.msg === "unhandled request error");
    expect(failure?.["error.stack"]).toEqual(expect.stringMatching(/^ {4}at /));
    expect(await everythingEmitted()).not.toContain(CANARY);
    expect(response.body).not.toContain(CANARY);
  });

  it("logs a database error's SQLSTATE and constraint name and none of its text", async () => {
    const response = await scoped.inject({ method: "GET", url: "/database" });

    expect(response.statusCode).toBe(500);
    const failure = telemetry.logs().find((line) => line.msg === "unhandled request error");
    expect(failure).toMatchObject({ "error.type": "Error", "error.code": SQLSTATE.uniqueViolation, "db.constraint": "response_pkey" });
    expect(response.body).not.toContain(CANARY);
    expect(await everythingEmitted()).not.toContain(CANARY);
  });

  it("logs an invariant violation's name and ids, and puts them on the active span", async () => {
    const response = await withSpan("session.submit", {}, async () => scoped.inject({ method: "GET", url: "/invariant" }));

    expect(response.statusCode).toBe(500);
    const failure = telemetry.logs().find((line) => line.msg === "unhandled request error");
    expect(failure).toMatchObject({
      level: "error",
      "error.type": "InvariantViolation",
      "error.invariant": "session.not-marked-submitted",
      "questionnaire.session_id": "s-1",
      "questionnaire.version": 2,
    });
    expect(telemetry.spans()[0]?.attributes).toMatchObject({
      "error.invariant": "session.not-marked-submitted",
      "questionnaire.session_id": "s-1",
      "error.type": "InvariantViolation",
    });
  });

  it("logs a problem response as its slug, status and codes, never its pointer, detail, title or URL", async () => {
    await scoped.inject({ method: "POST", url: "/things", payload: { [CANARY]: 1 } });
    await scoped.inject({ method: "GET", url: `/closed/${CANARY}` });

    const lines = telemetry.logs().filter((line) => line.msg === "problem response");
    expect(lines).toEqual([
      expect.objectContaining({ level: "info", "problem.slug": "request/invalid", "problem.code": "schema/required", "http.response.status_code": 400 }),
      expect.objectContaining({ level: "info", "problem.slug": "questionnaire/closed", "http.response.status_code": 409, "http.route": "/closed/:sessionId" }),
    ]);
    expect(await everythingEmitted()).not.toContain(CANARY);
  });

  it("logs a 500 problem response at error level", async () => {
    await scoped.inject({ method: "GET", url: "/plain/x" });

    expect(telemetry.logs().find((line) => line.msg === "problem response")).toMatchObject({
      level: "error",
      "problem.slug": "internal",
      "http.response.status_code": 500,
    });
  });
});

describe("with the real SDK and its Fastify instrumentation", () => {
  const BROWSER_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
  const BROWSER_SPAN_ID = "b7ad6b7169203331";

  let collector: Server;
  let exported: string[];
  let handle: TelemetryHandle;
  let instrumented: FastifyInstance;

  function exportedSpans(): { name: string; traceId: string; parentSpanId?: string }[] {
    return exported
      .filter((body) => body.startsWith("/v1/traces"))
      .flatMap((body) => JSON.parse(body.slice(body.indexOf("\n") + 1)).resourceSpans)
      .flatMap((resource) => resource.scopeSpans)
      .flatMap((scope) => scope.spans);
  }

  beforeAll(async () => {
    exported = [];
    collector = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        exported.push(`${request.url}\n${Buffer.concat(chunks).toString("utf8")}`);
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve));
    const { port } = collector.address() as AddressInfo;
    handle = startTelemetry({
      serviceName: "qp-test",
      logLevel: "error",
      prettyLogs: false,
      otlpEndpoint: `http://127.0.0.1:${port}`,
      autoInstrumentation: true,
    });
  });

  afterAll(async () => {
    await handle.shutdown();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  });

  beforeEach(async () => {
    exported.length = 0;
    instrumented = Fastify();
    applyHttpDefaults(instrumented, replyWithProblem);
    instrumented.get("/sessions/:sessionId", async () => {
      throw InvariantViolation.of("session.not-marked-submitted", { sessionId: "s-1" });
    });
    await instrumented.ready();
  });

  afterEach(async () => {
    await instrumented.close();
  });

  it("continues the browser's trace from an incoming traceparent and answers a 500 with that trace id", async () => {
    const response = await instrumented.inject({
      method: "GET",
      url: `/sessions/${CANARY}?cursor=${CANARY}`,
      headers: { traceparent: `00-${BROWSER_TRACE_ID}-${BROWSER_SPAN_ID}-01` },
    });
    await handle.flush();

    expect(response.statusCode).toBe(500);
    expect(response.json().detail).toBe(BROWSER_TRACE_ID);
    const requestSpan = exportedSpans().find((span) => span.name === "request");
    expect(requestSpan).toMatchObject({ traceId: BROWSER_TRACE_ID, parentSpanId: BROWSER_SPAN_ID });
    expect(JSON.stringify(requestSpan)).toContain("session.not-marked-submitted");
  });

  it("exports no URL, path, query or error message from the request span", async () => {
    await instrumented.inject({ method: "GET", url: `/sessions/${CANARY}?cursor=${CANARY}` });
    await handle.flush();

    const traces = exported.filter((body) => body.startsWith("/v1/traces")).join("\n");
    expect(traces).toContain("http.route");
    expect(traces).not.toContain(CANARY);
    expect(traces).not.toContain("url.path");
    expect(traces).not.toContain("url.full");
    expect(traces).not.toContain("exception.message");
  });
});
