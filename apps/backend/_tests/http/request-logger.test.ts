import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyHttpDefaults, replyWithProblem } from "../../src/http/problems.js";
import { requestLogger } from "../../src/http/request-logger.js";

const CANARY = "CANARY_DIABETES_8F3A";

let telemetry: TestTelemetry;
let app: FastifyInstance;

beforeEach(async () => {
  telemetry = installTestTelemetry();
  app = Fastify({ loggerInstance: requestLogger("info") });
  applyHttpDefaults(app, replyWithProblem);
  app.get("/sessions/:sessionId", async () => ({ ok: true }));
  app.get("/explode", async () => {
    throw new TypeError(`bad value ${CANARY}`);
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await telemetry.shutdown();
});

describe("the Fastify logger backed by the telemetry logger", () => {
  it("logs a request's method, route template, status and duration, never its URL", async () => {
    await app.inject({ method: "GET", url: `/sessions/${CANARY}?token=${CANARY}` });

    const completed = telemetry.logs().find((line) => line.msg === "request completed");
    expect(completed).toMatchObject({
      level: "info",
      module: "http",
      "http.request.method": "GET",
      "http.route": "/sessions/:sessionId",
      "http.response.status_code": 200,
    });
    expect(completed?.["http.request.id"]).toBe("req-1");
    expect(completed?.["http.server.request.duration_ms"]).toEqual(expect.any(Number));
    expect(JSON.stringify(telemetry.logs())).not.toContain(CANARY);
  });

  it("logs an unhandled failure as its error type, without its message", async () => {
    const response = await app.inject({ method: "GET", url: "/explode" });

    expect(response.statusCode).toBe(500);
    const failure = telemetry.logs().find((line) => line.msg === "unhandled request error");
    expect(failure).toMatchObject({ level: "error", "error.type": "TypeError" });
    expect(JSON.stringify(telemetry.logs())).not.toContain(CANARY);
  });

  it("replaces a message it does not know with a fixed one", async () => {
    app.log.info({ req: { method: "GET", url: `/sessions/${CANARY}` } }, `free text ${CANARY}`);

    const [line] = telemetry.logs();
    expect(line).toMatchObject({ msg: "fastify log", "http.request.method": "GET" });
    expect(JSON.stringify(telemetry.logs())).not.toContain(CANARY);
  });

  it("keeps a child logger's request id on every line", async () => {
    const child = app.log.child({ reqId: "req-1" });
    child.info("incoming request");
    child.warn("incoming request");

    expect(telemetry.logs().map((line) => line["http.request.id"])).toEqual(["req-1", "req-1"]);
  });
});
