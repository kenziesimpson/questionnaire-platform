import { afterEach, describe, expect, it } from "vitest";
import { ingestBatch, withSpan } from "../src/index.js";
import { configureLogging, resetLogging, type LogRecord } from "../src/logger.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { browserDomainEventOf } from "../src/wire-contract.js";
import { ingestDropsIn, installFaultyMeter, metricPointsIn, internalDropsOf, restoreFaults } from "./faults.js";
import { QUESTION_ID, SESSION_ID } from "./fixtures.js";

const LEAK = "LEAK_DIABETES_8F3A";

const AT = "2026-09-19T10:00:00.000Z";

const RECEIVED_AT = Date.parse("2026-09-19T10:00:05.000Z");

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

let telemetry: TestTelemetry | undefined;

function install(): TestTelemetry {
  const installed = installTestTelemetry();
  telemetry = installed;
  return installed;
}

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
  resetLogging();
  restoreFaults();
});

describe("ingestBatch: what a browser log line keeps", () => {
  it("re-emits a client log event as a log line in the browser module, at the level its name carries, with the server's stamps", () => {
    const installed = install();

    const receipt = ingestBatch([{ name: "client.warn", at: AT, fields: { method: "POST", route: "/api/run/sessions/:sessionId" } }], RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 1, dropped: 0 });
    expect(installed.logs()).toMatchObject([
      {
        level: "warn",
        msg: "client.warn",
        module: "browser",
        "http.request.method": "POST",
        "http.route": "/api/run/sessions/:sessionId",
        "telemetry.source": "browser",
        "telemetry.event_age_ms": 5000,
      },
    ]);
  });

  it("keeps the frames of a client error and its class, and nothing else it says about itself", () => {
    const installed = install();
    const frames = "    at render (index-Ab3_x.js:1:2)\n    at commit (index-Ab3_x.js:3:4)";

    ingestBatch(
      [{ name: "client.error", at: AT, fields: { errorType: "TypeError", errorStack: frames, message: "Cannot read 'x' of undefined", detail: LEAK } }],
      RECEIVED_AT,
    );

    const [line] = installed.logs();
    expect(line).toMatchObject({ level: "error", "error.type": "TypeError", "error.stack": frames });
    expect(JSON.stringify(line)).not.toContain("Cannot read");
    expect(JSON.stringify(line)).not.toContain(LEAK);
  });

  it("refuses a stack whose lines are not frames", async () => {
    const installed = install();

    ingestBatch([{ name: "client.error", at: AT, fields: { errorType: "Error", errorStack: `Error: ${LEAK}\n    at x (y.js:1:1)` } }], RECEIVED_AT);

    expect(installed.logs()[0]).not.toHaveProperty("error.stack");
    expect(await ingestDropsIn(installed)).toEqual({ invalid_field: 1 });
  });

  it.each([
    ["a function name that is free text", `    at ${LEAK} patient answered yes (x.js:1:1)`],
    ["a dotted function name that is the sentinel", `    at Object.${LEAK} (x.js:1:2)`],
    ["a function name that is the lower-cased sentinel", `    at ${LEAK.toLowerCase()} (x.js:1:2)`],
    ["a function name that is a phrase", "    at patient answered yes (x.js:1:1)"],
    ["a URL location", "    at render (http://localhost/assets/index.js:1:2)"],
    ["a bare URL location", "    at http://localhost/assets/index.js:1:2"],
    ["a file path location", "    at render (/srv/app/index.js:1:2)"],
    ["a location that is not a script", "    at render (x.txt:1:1)"],
    ["a location with a query", "    at render (x.js?answer=yes:1:1)"],
    ["a marker that is not one", `    at render (${LEAK})`],
    ["a line that is not indented four spaces", "  at render (x.js:1:1)"],
    ["a line that is not a frame", `${LEAK}`],
    ["a frame with trailing text", `    at render (x.js:1:1) ${LEAK}`],
    ["a frame that is too long", `    at render (${"a".repeat(200)}.js:1:1)`],
    ["a stack of a hundred frames", Array.from({ length: 100 }, () => "    at render (x.js:1:1)").join("\n")],
    ["an empty stack", ""],
    ["a stack that is not a string", 7],
  ])("drops an errorStack with %s, counts it and keeps the event", async (_name, errorStack) => {
    const installed = install();

    const receipt = ingestBatch([{ name: "client.error", at: AT, fields: { errorType: "Error", errorStack } }], RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 1, dropped: 0 });
    expect(installed.logs()[0]).not.toHaveProperty("error.stack");
    expect(JSON.stringify(installed.logs())).not.toContain(LEAK);
    expect(await ingestDropsIn(installed)).toEqual({ invalid_field: 1 });
  });

  it.each([
    "    at render (index.js:1:2)",
    "    at Object.render (index-Ab3_x.mjs:10:20)",
    "    at async App.load (chunk-1.js:5:6)",
    "    at new Widget (main.js:7:8)",
    "    at anonymous (anonymous.js:1:1)",
    "    at <anonymous>.run (x.js:1:1)",
    "    at render (<anonymous>)",
    "    at render (native)",
    "    at index.js:3:4",
    "    at render (a.js:1:1)\n    at commit (b.js:2:2)",
  ])("keeps the errorStack %j", (errorStack) => {
    const installed = install();

    ingestBatch([{ name: "client.error", at: AT, fields: { errorStack } }], RECEIVED_AT);

    expect(installed.logs()[0]).toMatchObject({ "error.stack": errorStack });
  });
});

describe("ingestBatch: what a browser domain event keeps", () => {
  it("relays session.abandoned through the event log and its counter, and treats a null field as absent", async () => {
    const installed = install();

    ingestBatch([{ name: "session.abandoned", at: AT, fields: { sessionId: SESSION_ID, lastItemId: null } }], RECEIVED_AT);

    expect(installed.logs()).toMatchObject([
      { level: "info", msg: "session.abandoned", module: "events", "questionnaire.session_id": SESSION_ID, "telemetry.source": "browser" },
    ]);
    expect(installed.logs()[0]).not.toHaveProperty("questionnaire.last_item_id");
    expect((await metricPointsIn(installed, "questionnaire.sessions.abandoned")).map((point) => point.value)).toEqual([1]);
    expect(await ingestDropsIn(installed)).toEqual({});
  });

  it("refuses session.item_skipped and the other events the server owns, counting each one", async () => {
    const installed = install();

    const receipt = ingestBatch(
      [
        { name: "session.item_skipped", at: AT, fields: { sessionId: SESSION_ID, itemId: "itm_03", questionId: QUESTION_ID } },
        { name: "session.completed", at: AT, fields: { sessionId: SESSION_ID, durationMs: 1, questionCount: 1 } },
        { name: "questionnaire.published", at: AT, fields: {} },
        { name: "session.submit_finished", at: AT, fields: { outcome: "accepted" } },
      ],
      RECEIVED_AT,
    );

    expect(receipt).toEqual({ accepted: 0, dropped: 4 });
    expect(installed.logs()).toEqual([]);
    expect(await ingestDropsIn(installed)).toEqual({ unknown_event: 4 });
    expect(await metricPointsIn(installed, "questionnaire.sessions.completed")).toEqual([]);
    expect(await metricPointsIn(installed, "questionnaire.session.duration")).toEqual([]);
  });
});

describe("ingestBatch: only the fields a browser legitimately knows are kept", () => {
  it.each([
    ["constraint", "leak_diabetes_8f3a"],
    ["constraint", "response_pkey"],
    ["invariant", "leak.diabetes"],
    ["errorCode", "12345"],
    ["requestId", SESSION_ID],
    ["problem", "internal"],
    ["problemCode", "answer/required"],
    ["pool", "definition"],
    ["signal", "SIGINT"],
    ["status", 500],
    ["source", "server"],
    ["eventAgeMs", 1],
    ["outcome", "accepted"],
    ["reason", "answer/required"],
    ["durationMs", 1],
    ["responseTimeMs", 1],
  ])("drops the server-owned field %s = %j from a client log line, counts it and keeps the event", async (field, value) => {
    const installed = install();

    const receipt = ingestBatch([{ name: "client.error", at: AT, fields: { [field]: value } }], RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 1, dropped: 0 });
    expect(await ingestDropsIn(installed)).toEqual({ unknown_field: 1 });
    if (typeof value === "string") expect(JSON.stringify(installed.logs())).not.toContain(value);
  });

  it("keeps only the fields a session.abandoned event carries, and drops the rest as unknown", async () => {
    const installed = install();

    ingestBatch(
      [{ name: "session.abandoned", at: AT, fields: { sessionId: SESSION_ID, lastItemId: "itm_03", questionCount: 4, elapsedSeconds: 90, errorType: "Error", route: "/x" } }],
      RECEIVED_AT,
    );

    expect(installed.logs()[0]).toMatchObject({ "questionnaire.session_id": SESSION_ID, "questionnaire.last_item_id": "itm_03" });
    expect(installed.logs()[0]).not.toHaveProperty("error.type");
    expect(installed.logs()[0]).not.toHaveProperty("questionnaire.question_count");
    expect(installed.logs()[0]).not.toHaveProperty("questionnaire.elapsed_seconds");
    expect(await ingestDropsIn(installed)).toEqual({ unknown_field: 4 });
  });

  it("drops the finding count fields from every browser event, since only the server counts findings", async () => {
    const installed = install();
    const counts = { findingCount: 3, omittedCount: 1, codeFindingCount: 2 };

    ingestBatch(
      [
        { name: "session.abandoned", at: AT, fields: { sessionId: SESSION_ID, ...counts } },
        { name: "client.error", at: AT, fields: { errorType: "Error", ...counts } },
      ],
      RECEIVED_AT,
    );

    for (const line of installed.logs()) {
      expect(line).not.toHaveProperty("questionnaire.finding_count");
      expect(line).not.toHaveProperty("questionnaire.omitted_count");
      expect(line).not.toHaveProperty("questionnaire.code_finding_count");
    }
    expect(await ingestDropsIn(installed)).toEqual({ unknown_field: 6 });
  });

  it("accepts exactly the client log events and session.abandoned", () => {
    install();

    const names = ["client.info", "client.warn", "client.error", "session.abandoned", "session.item_skipped", "session.completed"];
    const receipt = ingestBatch(names.map((name) => ({ name, at: AT })), RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 4, dropped: 2 });
    expect(browserDomainEventOf("session.abandoned")).toBe("session.abandoned");
    expect(browserDomainEventOf("session.item_skipped")).toBeUndefined();
  });
});

describe("ingestBatch: the registry decides what is kept, and every drop is counted", () => {
  it("drops a field outside the registry and a value that fails its field, keeps the rest of the event, and counts each by reason", async () => {
    const installed = install();

    const receipt = ingestBatch(
      [
        {
          name: "client.info",
          at: AT,
          fields: { sessionId: SESSION_ID, answer: LEAK, text: LEAK, nested: { sessionId: LEAK }, itemId: "Not A Slug", status: "500", questionType: LEAK },
        },
      ],
      RECEIVED_AT,
    );

    expect(receipt).toEqual({ accepted: 1, dropped: 0 });
    expect(installed.logs()).toHaveLength(1);
    expect(installed.logs()[0]).toMatchObject({ "questionnaire.session_id": SESSION_ID });
    expect(JSON.stringify(installed.logs())).not.toContain(LEAK);
    expect(await ingestDropsIn(installed)).toEqual({ unknown_field: 4, invalid_field: 2 });
  });

  it("never lets a browser set the fields the server stamps", () => {
    const installed = install();

    ingestBatch([{ name: "client.info", at: AT, fields: { source: "server", eventAgeMs: 1 } }], RECEIVED_AT);

    expect(installed.logs()[0]).toMatchObject({ "telemetry.source": "browser", "telemetry.event_age_ms": 5000 });
  });

  it("does not stamp a negative age when the browser clock is ahead", () => {
    const installed = install();

    ingestBatch([{ name: "client.info", at: "2026-09-19T10:01:00.000Z", fields: {} }], RECEIVED_AT);

    expect(installed.logs()[0]).toMatchObject({ "telemetry.event_age_ms": 0 });
  });

  it.each([
    ["a string", "client.info"],
    ["null", null],
    ["a number", 7],
    ["an array", ["client.info"]],
    ["an event with no name", { at: AT }],
    ["an event whose name is not a string", { name: 7, at: AT }],
    ["an event with no timestamp", { name: "client.info" }],
    ["an event whose timestamp is not a date", { name: "client.info", at: "yesterday" }],
    ["an event whose fields are a string", { name: "client.info", at: AT, fields: LEAK }],
    ["an event whose fields are an array", { name: "client.info", at: AT, fields: [LEAK] }],
  ])("drops %s as malformed and keeps the events around it", async (_name, malformed) => {
    const installed = install();

    const receipt = ingestBatch([{ name: "client.info", at: AT, fields: {} }, malformed, { name: "client.warn", at: AT }], RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 2, dropped: 1 });
    expect(installed.logs().map((line) => line.msg)).toEqual(["client.info", "client.warn"]);
    expect(await ingestDropsIn(installed)).toEqual({ malformed: 1 });
  });

  it.each([LEAK, LEAK.toLowerCase(), `client.info ${LEAK}`, "client.debug", "CLIENT.INFO", "toString", "__proto__", ""])(
    "drops an event named %j, keeps it out of every signal and counts it",
    async (name) => {
      const installed = install();

      const receipt = ingestBatch([{ name, at: AT, fields: { sessionId: SESSION_ID } }], RECEIVED_AT);

      expect(receipt).toEqual({ accepted: 0, dropped: 1 });
      expect(installed.logs()).toEqual([]);
      expect(await ingestDropsIn(installed)).toEqual({ unknown_event: 1 });
      expect(JSON.stringify(await installed.metrics())).not.toContain(LEAK);
    },
  );

  it("keeps the first events of an oversized batch, drops the rest and counts them as over the limit", async () => {
    const installed = install();
    const events = Array.from({ length: 53 }, () => ({ name: "client.info", at: AT, fields: {} }));

    const receipt = ingestBatch(events, RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 50, dropped: 3 });
    expect(installed.logs()).toHaveLength(50);
    expect(await ingestDropsIn(installed)).toEqual({ over_limit: 3 });
  });
});

describe("ingestBatch: trace context", () => {
  it("logs a client event under the trace and span the browser sent", () => {
    const installed = install();

    ingestBatch([{ name: "client.info", at: AT, traceparent: TRACEPARENT }], RECEIVED_AT);

    expect(installed.logs()[0]).toMatchObject({ trace_id: "0af7651916cd43dd8448eb211c80319c", span_id: "b7ad6b7169203331" });
  });

  it("logs a client event under the server's active trace when the browser sent none", async () => {
    const installed = install();

    await withSpan("session.submit", {}, async () => ingestBatch([{ name: "client.info", at: AT }], RECEIVED_AT));

    const [span] = installed.spans();
    expect(installed.logs()[0]).toMatchObject({ trace_id: span?.spanContext().traceId });
  });

  it.each([
    ["not a traceparent", "abc"],
    ["a wrong version", "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"],
    ["an all-zero trace id", "00-00000000000000000000000000000000-b7ad6b7169203331-01"],
    ["an all-zero span id", "00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01"],
    ["upper-case hex", "00-0AF7651916CD43DD8448EB211C80319C-B7AD6B7169203331-01"],
    ["a number", 7],
    ["the sentinel", LEAK],
  ])("keeps the event, ignores %s and counts it", async (_name, traceparent) => {
    const installed = install();

    const receipt = ingestBatch([{ name: "client.info", at: AT, traceparent }], RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 1, dropped: 0 });
    expect(installed.logs()[0]).not.toHaveProperty("trace_id");
    expect(JSON.stringify(installed.logs())).not.toContain(LEAK);
    expect(await ingestDropsIn(installed)).toEqual({ invalid_trace: 1 });
  });
});

describe("ingestBatch never throws into the handler", () => {
  const written: LogRecord[] = [];

  function recordingSink(): void {
    written.length = 0;
    configureLogging({ level: "debug", sink: (record) => void written.push(record) });
  }

  function throwingSink(): void {
    configureLogging({
      level: "debug",
      sink: () => {
        throw new Error("sink failed");
      },
    });
  }

  const good = { name: "client.info", at: AT, fields: { sessionId: SESSION_ID } };

  it("drops each event whose log line the sink cannot take, counts one internal log drop for it, and still returns a receipt", () => {
    const recorded = installFaultyMeter();
    throwingSink();

    const receipt = ingestBatch([good, good, good], RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 0, dropped: 3 });
    expect(internalDropsOf(recorded)).toEqual(["log", "log", "log"]);
  });

  it("keeps an event whose counter fails, since its line was written, and counts one internal metric drop", () => {
    const recorded = installFaultyMeter({ failing: ["questionnaire.sessions.abandoned"] });
    recordingSink();

    const receipt = ingestBatch([{ name: "session.abandoned", at: AT, fields: { sessionId: SESSION_ID } }], RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 1, dropped: 0 });
    expect(written.map((record) => record.message)).toEqual(["session.abandoned"]);
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });

  it("returns the right receipt for refused events when the drop counter fails, and counts internal metric drops", () => {
    const recorded = installFaultyMeter({ failing: ["telemetry.ingest.dropped"] });
    recordingSink();

    const receipt = ingestBatch([{ name: "not.allowed", at: AT }, "not an event", good], RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 1, dropped: 2 });
    expect(written).toHaveLength(1);
    expect(internalDropsOf(recorded)).toEqual(["metric", "metric"]);
  });

  it("returns a receipt when the meter itself is unavailable", () => {
    installFaultyMeter({ unavailable: true });
    recordingSink();

    expect(ingestBatch([good, { name: "not.allowed", at: AT }], RECEIVED_AT)).toEqual({ accepted: 1, dropped: 1 });
  });

  it("drops an event whose fields throw when read, emits nothing partial for it, keeps the events around it, and counts an internal log drop", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    const hostileFields = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("hostile keys");
        },
      },
    );
    const hostileEvent = new Proxy(
      {},
      {
        get: () => {
          throw new Error("hostile getter");
        },
      },
    );

    const receipt = ingestBatch([good, { name: "client.info", at: AT, fields: hostileFields }, hostileEvent, good], RECEIVED_AT);

    expect(receipt).toEqual({ accepted: 2, dropped: 2 });
    expect(written).toHaveLength(2);
    expect(internalDropsOf(recorded)).toEqual(["log", "log"]);
  });

  it("returns an empty receipt, and counts an internal log drop, when the batch itself cannot be read", () => {
    const recorded = installFaultyMeter();
    const hostileBatch = new Proxy([], {
      get: () => {
        throw new Error("hostile batch");
      },
    });

    expect(ingestBatch(hostileBatch, RECEIVED_AT)).toEqual({ accepted: 0, dropped: 0 });
    expect(internalDropsOf(recorded)).toEqual(["log"]);
  });
});
