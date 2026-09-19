import { afterEach, describe, expect, it } from "vitest";
import { logger, withSpan } from "../src/index.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { SESSION_ID } from "./fixtures.js";

const CANARY = "CANARY_DIABETES_8F3A";

const log = logger("execution");

let telemetry: TestTelemetry | undefined;

function install(level?: "debug" | "info" | "warn" | "error"): TestTelemetry {
  telemetry = installTestTelemetry(level === undefined ? {} : { logLevel: level });
  return telemetry;
}

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
});

function emitEveryLevel(): void {
  log.debug("debug line");
  log.info("info line");
  log.warn("warn line");
  log.error("error line");
}

function levelsLogged(installed: TestTelemetry): unknown[] {
  return installed.logs().map((line) => line.level);
}

describe("logger level filtering", () => {
  it("emits every level from debug up when the threshold is debug", () => {
    const installed = install("debug");
    emitEveryLevel();
    expect(levelsLogged(installed)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("drops debug below an info threshold", () => {
    const installed = install("info");
    emitEveryLevel();
    expect(levelsLogged(installed)).toEqual(["info", "warn", "error"]);
  });

  it("emits only warn and error at a warn threshold", () => {
    const installed = install("warn");
    emitEveryLevel();
    expect(levelsLogged(installed)).toEqual(["warn", "error"]);
  });

  it("emits only error at an error threshold", () => {
    const installed = install("error");
    emitEveryLevel();
    expect(levelsLogged(installed)).toEqual(["error"]);
  });

  it("emits nothing before telemetry has started", async () => {
    const installed = install("debug");
    await installed.shutdown();
    emitEveryLevel();
    expect(installed.logs()).toEqual([]);
  });
});

describe("logger records", () => {
  it("writes the message, level, module and registered fields, and nothing else", () => {
    const installed = install();
    log.info("session submitted", { sessionId: SESSION_ID, questionnaireVersion: 2, outcome: "accepted" });
    const [line] = installed.logs();
    expect(line).toMatchObject({
      level: "info",
      msg: "session submitted",
      module: "execution",
      "questionnaire.session_id": SESSION_ID,
      "questionnaire.version": 2,
      "questionnaire.outcome": "accepted",
    });
    expect(Object.keys(line ?? {}).sort()).toEqual([
      "level",
      "module",
      "msg",
      "questionnaire.outcome",
      "questionnaire.session_id",
      "questionnaire.version",
      "time",
    ]);
  });

  it("drops a field outside the registry and keeps the line", () => {
    const installed = install();
    // @ts-expect-error — the closed context rejects an unknown field at compile time; the scrub is the runtime backstop
    log.info("answer received", { sessionId: SESSION_ID, value: CANARY });
    const [line] = installed.logs();
    expect(line).toMatchObject({ msg: "answer received", "questionnaire.session_id": SESSION_ID });
    expect(JSON.stringify(line)).not.toContain(CANARY);
  });

  it("carries the active span's trace and span ids", async () => {
    const installed = install();
    await withSpan("session.submit", { sessionId: SESSION_ID }, async () => {
      log.info("inside");
    });
    log.info("outside");
    const [inside, outside] = installed.logs();
    const [span] = installed.spans();
    expect(inside).toMatchObject({ trace_id: span?.spanContext().traceId, span_id: span?.spanContext().spanId });
    expect(outside).not.toHaveProperty("trace_id");
  });

  it("records an error's type and stack frames but never its message", () => {
    const installed = install();
    log.error("submit failed", { status: 500 }, new TypeError(`bad value ${CANARY}`));
    const [line] = installed.logs();
    expect(line).toMatchObject({ "error.type": "TypeError", "http.response.status_code": 500 });
    expect(line?.["error.stack"]).toMatch(/^ {4}at /);
    expect(JSON.stringify(line)).not.toContain(CANARY);
  });

  it("omits the stack when an error carries no frames", () => {
    const installed = install();
    const bare = new Error(CANARY);
    bare.stack = `Error: ${CANARY}`;
    log.error("failed", undefined, bare);
    const [line] = installed.logs();
    expect(line).toMatchObject({ "error.type": "Error" });
    expect(line).not.toHaveProperty("error.stack");
    expect(JSON.stringify(line)).not.toContain(CANARY);
  });

  it("drops a stack line an error message forged", () => {
    const installed = install();
    const forged = new Error("x");
    forged.stack = `Error: x\n    at ${CANARY} secret\n    at run (file:///app/dist/a.js:1:2)`;
    log.error("failed", undefined, forged);
    const [line] = installed.logs();
    expect(line?.["error.stack"]).toBe("    at run (file:///app/dist/a.js:1:2)");
    expect(JSON.stringify(line)).not.toContain(CANARY);
  });

  it("drops the whole header of a multi-line message, so a frame-shaped line in it is never recorded", () => {
    const installed = install();
    log.error("failed", undefined, new Error(`line1\n    at ${CANARY} (secret.txt:1:1)\n    at ${CANARY}_2 (secret.txt:2:2)`));
    const [line] = installed.logs();
    expect(line).toMatchObject({ "error.type": "Error" });
    expect(line?.["error.stack"]).toMatch(/^ {4}at /);
    expect(JSON.stringify(line)).not.toContain(CANARY);
  });

  it("records no stack when the stack's header does not line up with the message", () => {
    const installed = install();
    const mutated = new Error("original");
    void mutated.stack;
    mutated.message = `changed\n    at ${CANARY} (secret.txt:1:1)`;
    log.error("failed", undefined, mutated);
    const [line] = installed.logs();
    expect(line).not.toHaveProperty("error.stack");
    expect(JSON.stringify(line)).not.toContain(CANARY);
  });

  it("records the frames of an error whose name is set after construction", () => {
    const installed = install();
    class Named extends Error {
      constructor() {
        super(`bad ${CANARY}`);
        this.name = "Named";
      }
    }
    log.error("failed", undefined, new Named());
    const [line] = installed.logs();
    expect(line).toMatchObject({ "error.type": "Named" });
    expect(line?.["error.stack"]).toMatch(/^ {4}at /);
    expect(JSON.stringify(line)).not.toContain(CANARY);
  });
});
