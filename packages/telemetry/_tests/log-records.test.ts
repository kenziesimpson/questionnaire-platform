import { SeverityNumber, logs } from "@opentelemetry/api-logs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitDomainEvent, logger, withSpan } from "../src/index.js";
import { LOG_SEVERITIES } from "../src/log-records.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { internalDropsIn } from "./faults.js";
import { QUESTIONNAIRE_ID, SESSION_ID } from "./fixtures.js";

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await telemetry?.shutdown();
  telemetry = undefined;
});

describe("a log line is also emitted as an OpenTelemetry log record", () => {
  it("carries the literal message as its body, the level as its severity and the registered fields as attributes", () => {
    telemetry = installTestTelemetry();

    logger("execution").warn("answer rejected", { sessionId: SESSION_ID, reason: "answer/required" });

    const [record] = telemetry.logRecords();
    expect(record?.body).toBe("answer rejected");
    expect(record?.severityText).toBe("WARN");
    expect(record?.severityNumber).toBe(SeverityNumber.WARN);
    expect(record?.attributes).toEqual({ module: "execution", "questionnaire.session_id": SESSION_ID, "questionnaire.reason": "answer/required" });
  });

  it.each(["debug", "info", "warn", "error"] as const)("maps the level %s to one severity number and one severity text", (level) => {
    telemetry = installTestTelemetry();

    logger("http")[level]("a message");

    const [record] = telemetry.logRecords();
    expect(record?.severityNumber).toBe(LOG_SEVERITIES[level].number);
    expect(record?.severityText).toBe(LOG_SEVERITIES[level].text);
  });

  it("carries the trace context natively and not as trace_id and span_id attributes", async () => {
    telemetry = installTestTelemetry();
    let traceId: string | undefined;

    await withSpan("session.submit", { sessionId: SESSION_ID }, async () => {
      logger("execution").info("submitting");
      traceId = telemetry?.logRecords()[0]?.spanContext?.traceId;
    });

    const [record] = telemetry.logRecords();
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(record?.spanContext?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(record?.attributes).not.toHaveProperty("trace_id");
    expect(record?.attributes).not.toHaveProperty("span_id");
    expect(telemetry.logs()[0]).toMatchObject({ trace_id: traceId });
  });

  it("emits a domain event as a record named for the event", () => {
    telemetry = installTestTelemetry();

    emitDomainEvent({ name: "session.started", sessionId: SESSION_ID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1 });

    expect(telemetry.logRecords().map((record) => record.body)).toEqual(["session.started"]);
  });

  it("emits nothing below the log level threshold, as the pino line does not", () => {
    telemetry = installTestTelemetry({ logLevel: "warn" });

    logger("http").info("quiet");

    expect(telemetry.logs()).toEqual([]);
    expect(telemetry.logRecords()).toEqual([]);
  });

  it("writes the same lines to stdout as it did before, whatever the exporter does", () => {
    telemetry = installTestTelemetry();

    logger("execution").info("a line", { sessionId: SESSION_ID });

    expect(telemetry.logs()).toEqual([expect.objectContaining({ level: "info", msg: "a line", module: "execution", "questionnaire.session_id": SESSION_ID })]);
  });

  it("keeps writing the line and counts one internal log drop when the record cannot be emitted", async () => {
    telemetry = installTestTelemetry();
    vi.spyOn(logs, "getLogger").mockImplementation(() => {
      throw new Error("no logger");
    });

    expect(() => {
      logger("execution").info("still written");
    }).not.toThrow();

    expect(telemetry.logs()).toHaveLength(1);
    expect(await internalDropsIn(telemetry)).toEqual({ log: 1 });
  });
});
