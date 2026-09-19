import { afterEach, describe, expect, it } from "vitest";
import { logger, withSpan } from "../src/index.js";
import { configureLogging, resetLogging, type LogRecord } from "../src/logger.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { DROPPED_COUNTER, installFaultyMeter, internalDropsOf, restoreFaults } from "./faults.js";
import { SESSION_ID } from "./fixtures.js";

const LEAK = "LEAK_DIABETES_8F3A";

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
    log.info("answer received", { sessionId: SESSION_ID, value: LEAK });
    const [line] = installed.logs();
    expect(line).toMatchObject({ msg: "answer received", "questionnaire.session_id": SESSION_ID });
    expect(JSON.stringify(line)).not.toContain(LEAK);
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
    log.error("submit failed", { status: 500 }, new TypeError(`bad value ${LEAK}`));
    const [line] = installed.logs();
    expect(line).toMatchObject({ "error.type": "TypeError", "http.response.status_code": 500 });
    expect(line?.["error.stack"]).toMatch(/^ {4}at /);
    expect(JSON.stringify(line)).not.toContain(LEAK);
  });

  it("omits the stack when an error carries no frames", () => {
    const installed = install();
    const bare = new Error(LEAK);
    bare.stack = `Error: ${LEAK}`;
    log.error("failed", undefined, bare);
    const [line] = installed.logs();
    expect(line).toMatchObject({ "error.type": "Error" });
    expect(line).not.toHaveProperty("error.stack");
    expect(JSON.stringify(line)).not.toContain(LEAK);
  });

  it("drops a stack line an error message forged", () => {
    const installed = install();
    const forged = new Error("x");
    forged.stack = `Error: x\n    at ${LEAK} secret\n    at run (file:///app/dist/a.js:1:2)`;
    log.error("failed", undefined, forged);
    const [line] = installed.logs();
    expect(line?.["error.stack"]).toBe("    at run (file:///app/dist/a.js:1:2)");
    expect(JSON.stringify(line)).not.toContain(LEAK);
  });

  it("drops the whole header of a multi-line message, so a frame-shaped line in it is never recorded", () => {
    const installed = install();
    log.error("failed", undefined, new Error(`line1\n    at ${LEAK} (secret.txt:1:1)\n    at ${LEAK}_2 (secret.txt:2:2)`));
    const [line] = installed.logs();
    expect(line).toMatchObject({ "error.type": "Error" });
    expect(line?.["error.stack"]).toMatch(/^ {4}at /);
    expect(JSON.stringify(line)).not.toContain(LEAK);
  });

  it("records no stack when the stack's header does not line up with the message", () => {
    const installed = install();
    const mutated = new Error("original");
    void mutated.stack;
    mutated.message = `changed\n    at ${LEAK} (secret.txt:1:1)`;
    log.error("failed", undefined, mutated);
    const [line] = installed.logs();
    expect(line).not.toHaveProperty("error.stack");
    expect(JSON.stringify(line)).not.toContain(LEAK);
  });

  it("records the frames of an error whose name is set after construction", () => {
    const installed = install();
    class Named extends Error {
      constructor() {
        super(`bad ${LEAK}`);
        this.name = "Named";
      }
    }
    log.error("failed", undefined, new Named());
    const [line] = installed.logs();
    expect(line).toMatchObject({ "error.type": "Named" });
    expect(line?.["error.stack"]).toMatch(/^ {4}at /);
    expect(JSON.stringify(line)).not.toContain(LEAK);
  });
});

describe("the logger never throws into the caller", () => {
  const written: LogRecord[] = [];

  function recordingSink(): void {
    written.length = 0;
    configureLogging({
      level: "debug",
      sink: (record) => {
        written.push(record);
      },
    });
  }

  function throwingSink(): void {
    configureLogging({
      level: "debug",
      sink: () => {
        throw new Error(`sink failed ${LEAK}`);
      },
    });
  }

  afterEach(() => {
    resetLogging();
    restoreFaults();
  });

  it("returns normally at every level when the sink throws, and counts one internal log drop per call", () => {
    const recorded = installFaultyMeter();
    throwingSink();
    expect(() => {
      log.debug("debug line", { sessionId: SESSION_ID });
      log.info("info line", { sessionId: SESSION_ID });
      log.warn("warn line", { sessionId: SESSION_ID });
      log.error("error line", { sessionId: SESSION_ID }, new Error("failed"));
    }).not.toThrow();
    expect(internalDropsOf(recorded)).toEqual(["log", "log", "log", "log"]);
    expect(JSON.stringify(recorded)).not.toContain(LEAK);
  });

  it("drops the whole line, and counts it, when the context has a throwing getter", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    const hostile = {
      sessionId: SESSION_ID,
      get itemId(): string {
        throw new Error(`hostile ${LEAK}`);
      },
    };
    expect(() => {
      log.info("hostile context", hostile);
    }).not.toThrow();
    expect(written).toEqual([]);
    expect(internalDropsOf(recorded)).toEqual(["log"]);
  });

  it("drops the whole line, and counts it, when the context is a proxy that throws", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("hostile");
        },
      },
    );
    expect(() => {
      log.warn("hostile context", hostile);
    }).not.toThrow();
    expect(written).toEqual([]);
    expect(internalDropsOf(recorded)).toEqual(["log"]);
  });

  it("drops the line, and counts it, when the error's name or stack throws", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    const hostileName = new Error("x");
    Object.defineProperty(hostileName, "name", {
      get: () => {
        throw new Error("hostile name");
      },
    });
    const hostileStack = new Error("x");
    Object.defineProperty(hostileStack, "stack", {
      get: () => {
        throw new Error("hostile stack");
      },
    });
    expect(() => {
      log.error("hostile name", undefined, hostileName);
      log.error("hostile stack", undefined, hostileStack);
    }).not.toThrow();
    expect(written).toEqual([]);
    expect(internalDropsOf(recorded)).toEqual(["log", "log"]);
  });

  it("returns normally, and still writes the line, when the drop counter throws while the scrub drops a field", () => {
    installFaultyMeter({ failing: [DROPPED_COUNTER] });
    recordingSink();
    // @ts-expect-error — the closed context rejects an unknown field at compile time; the scrub is the runtime backstop
    expect(() => log.info("answer received", { sessionId: SESSION_ID, value: LEAK })).not.toThrow();
    expect(written).toHaveLength(1);
    expect(JSON.stringify(written)).not.toContain(LEAK);
  });

  it("returns normally when getMeter throws", () => {
    installFaultyMeter({ unavailable: true });
    recordingSink();
    // @ts-expect-error — the closed context rejects an unknown field at compile time; the scrub is the runtime backstop
    expect(() => log.info("answer received", { value: LEAK })).not.toThrow();
    expect(written).toHaveLength(1);
  });

  it("keeps logging normally after a failure", () => {
    installFaultyMeter();
    throwingSink();
    log.info("fails");
    recordingSink();
    log.info("succeeds", { sessionId: SESSION_ID });
    expect(written.map((record) => record.message)).toEqual(["succeeds"]);
  });
});
