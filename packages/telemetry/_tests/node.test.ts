import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { afterEach, describe, expect, it } from "vitest";
import { emitDomainEvent, logger, withSpan } from "../src/index.js";
import { runningTelemetry, startTelemetry, type TelemetryHandle } from "../src/node.js";
import { SESSION_ID, QUESTIONNAIRE_ID } from "./fixtures.js";

const LEAK = "LEAK_DIABETES_8F3A";

interface Received {
  readonly path: string;
  readonly body: string;
}

interface Collector {
  readonly url: string;
  readonly received: Received[];
  close(): Promise<void>;
}

async function collector(): Promise<Collector> {
  const received: Received[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ path: request.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let handle: TelemetryHandle | undefined;
let sink: Collector | undefined;

afterEach(async () => {
  await handle?.shutdown();
  await sink?.close();
  handle = undefined;
  sink = undefined;
});

describe("startTelemetry with no endpoint configured", () => {
  it.each([undefined, ""])("exports nothing and reports it (endpoint %j)", (endpoint) => {
    handle = startTelemetry({ serviceName: "qp-test", logLevel: "error", prettyLogs: false, otlpEndpoint: endpoint, autoInstrumentation: false });
    expect(handle.exporting).toEqual({ traces: false, metrics: false, logs: false });
  });

  it("still records real spans so a log line can carry a trace id, and never throws", async () => {
    handle = startTelemetry({ serviceName: "qp-test", logLevel: "error", prettyLogs: false, otlpEndpoint: undefined, autoInstrumentation: false });
    let traceId: string | undefined;
    const value = await withSpan("session.submit", { sessionId: SESSION_ID }, async () => {
      traceId = trace.getActiveSpan()?.spanContext().traceId;
      return 5;
    });
    emitDomainEvent({ name: "session.started", sessionId: SESSION_ID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1 });
    await handle.flush();
    expect(value).toBe(5);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("shuts down cleanly and leaves the API calls as no-ops afterwards", async () => {
    handle = startTelemetry({ serviceName: "qp-test", logLevel: "error", prettyLogs: false, otlpEndpoint: undefined, autoInstrumentation: false });
    await handle.shutdown();
    handle = undefined;
    await expect(withSpan("session.submit", {}, async () => 1)).resolves.toBe(1);
    logger("execution").error("after shutdown");
    expect(trace.getActiveSpan()).toBeUndefined();
  });
});

describe("runningTelemetry", () => {
  it("is the handle startTelemetry returned until that handle shuts down", async () => {
    expect(runningTelemetry()).toBeUndefined();
    handle = startTelemetry({ serviceName: "qp-test", logLevel: "error", prettyLogs: false, otlpEndpoint: undefined, autoInstrumentation: false });
    expect(runningTelemetry()).toBe(handle);
    await handle.shutdown();
    handle = undefined;
    expect(runningTelemetry()).toBeUndefined();
  });
});

describe("startTelemetry with an endpoint configured", () => {
  it("posts traces, metrics and logs to the endpoint and carries no unregistered attribute", async () => {
    sink = await collector();
    handle = startTelemetry({ serviceName: "qp-test", logLevel: "error", prettyLogs: false, otlpEndpoint: `${sink.url}/`, autoInstrumentation: false });
    expect(handle.exporting).toEqual({ traces: true, metrics: true, logs: true });

    await withSpan("session.submit", { sessionId: SESSION_ID, outcome: "accepted" }, async () => {
      trace.getTracer("third-party").startSpan("GET", { attributes: { "http.request.body": LEAK, "url.path": `/sessions/${LEAK}` } }).end();
    });
    emitDomainEvent({ name: "session.started", sessionId: SESSION_ID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1 });
    logger("execution").error("submit failed", { sessionId: SESSION_ID });
    logs.getLogger("third-party").emit({ body: `answer=${LEAK}`, attributes: { answer: LEAK, "url.path": `/sessions/${LEAK}` } });
    await handle.flush();
    await handle.shutdown();
    handle = undefined;

    const paths = sink.received.map((request) => request.path);
    expect(paths).toContain("/v1/traces");
    expect(paths).toContain("/v1/metrics");
    expect(paths).toContain("/v1/logs");
    const logBodies = sink.received.filter((request) => request.path === "/v1/logs").map((request) => request.body).join("\n");
    expect(logBodies).toContain("submit failed");
    expect(logBodies).toContain("unnamed");
    expect(logBodies).not.toContain(LEAK);
    const bodies = sink.received.map((request) => request.body).join("\n");
    expect(bodies).toContain("session.submit");
    expect(bodies).toContain("questionnaire.sessions.started");
    expect(bodies).toContain("qp-test");
    expect(bodies).not.toContain(LEAK);
    expect(bodies).not.toContain("http.request.body");
    expect(bodies).not.toContain("url.path");
  });
});
