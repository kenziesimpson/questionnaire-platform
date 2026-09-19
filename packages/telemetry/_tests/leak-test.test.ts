import { SpanStatusCode, trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { sensitive } from "@qp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEAK_SENTINEL,
  expectCleanRun,
  expectEmitted,
  exposuresOf,
  plantThirdPartyCounter,
  plantThirdPartyTelemetry,
  runLeakFlow,
  type LeakFlow,
  type CapturedTelemetry,
} from "../src/leak-test.js";
import { logger, withSpan } from "../src/index.js";
import { installTestTelemetry } from "../src/testing.js";
import { SESSION_ID, QUESTIONNAIRE_ID } from "./fixtures.js";

function captured(parts: Partial<{ logs: Record<string, unknown>[]; spans: object[]; metrics: object[] }> = {}): CapturedTelemetry {
  return {
    logs: () => parts.logs ?? [],
    spans: () => (parts.spans ?? []).map((span) => ({ name: "a span", ...span })),
    metrics: async () => (parts.metrics ?? []).map((metric) => ({ descriptor: { name: "a.metric" }, ...metric })),
  };
}

describe("leak-test detector: exposuresOf", () => {
  it("reports nothing for telemetry that never saw the sentinel", async () => {
    const clean = captured({
      logs: [{ msg: "hello", "questionnaire.session_id": SESSION_ID }],
      spans: [{ attributes: { "questionnaire.id": QUESTIONNAIRE_ID } }],
      metrics: [{ dataPoints: [{ attributes: { "questionnaire.reason": "answer/required" }, value: 3 }] }],
    });

    expect(await exposuresOf(clean)).toEqual([]);
  });

  it("finds the sentinel in a log line, by message", async () => {
    const leaky = captured({ logs: [{ msg: "session submitted", answer: LEAK_SENTINEL }] });

    expect(await exposuresOf(leaky)).toEqual([{ signal: "log", name: "session submitted" }]);
  });

  it.each([
    ["a span attribute", { attributes: { "questionnaire.item_id": LEAK_SENTINEL } }],
    ["a span attribute key", { attributes: { [LEAK_SENTINEL]: 1 } }],
    ["a span event", { events: [{ name: "note", attributes: { detail: LEAK_SENTINEL } }] }],
    ["a span link", { links: [{ attributes: { detail: LEAK_SENTINEL } }] }],
    ["a span status message", { status: { code: SpanStatusCode.ERROR, message: LEAK_SENTINEL } }],
    ["a span resource", { resource: { attributes: { "service.name": LEAK_SENTINEL } } }],
    ["a real resource", { resource: resourceFromAttributes({ "service.name": LEAK_SENTINEL }) }],
    ["a Map", { attributes: new Map([["detail", LEAK_SENTINEL]]) }],
    ["a Set", { attributes: new Set([LEAK_SENTINEL]) }],
    ["a span name", { name: `publish ${LEAK_SENTINEL}` }],
  ])("finds the sentinel in %s", async (_where, span) => {
    const exposures = await exposuresOf(captured({ spans: [span] }));

    expect(exposures.map((exposure) => exposure.signal)).toEqual(["span"]);
  });

  it.each([
    ["a data point attribute", { dataPoints: [{ attributes: { reason: LEAK_SENTINEL }, value: 1 }] }],
    ["a metric description", { descriptor: { name: "a.metric", description: LEAK_SENTINEL } }],
    ["a histogram bucket key", { dataPoints: [{ attributes: {}, value: { buckets: { [LEAK_SENTINEL]: 1 } } }] }],
  ])("finds the sentinel in a metric's %s", async (_where, metric) => {
    const exposures = await exposuresOf(captured({ metrics: [metric] }));

    expect(exposures).toEqual([{ signal: "metric", name: "a.metric" }]);
  });

  it("matches regardless of case, so a lowercased answer is still caught", async () => {
    const leaky = captured({ logs: [{ msg: "x", answer: LEAK_SENTINEL.toLowerCase() }] });

    expect(await exposuresOf(leaky)).toHaveLength(1);
  });

  it("reports each signal that carries it", async () => {
    const leaky = captured({
      logs: [{ msg: "a", answer: LEAK_SENTINEL }],
      spans: [{ attributes: { answer: LEAK_SENTINEL } }],
      metrics: [{ dataPoints: [{ attributes: { answer: LEAK_SENTINEL } }] }],
    });

    expect((await exposuresOf(leaky)).map((exposure) => exposure.signal)).toEqual(["log", "span", "metric"]);
  });

  it("does not count a Sensitive wrapper, which serializes as redacted", async () => {
    const wrapped = captured({ logs: [{ msg: "x", answer: sensitive(LEAK_SENTINEL) }] });

    expect(await exposuresOf(wrapped)).toEqual([]);
  });

  it("finds the sentinel in an error's message even though JSON would hide it", async () => {
    const leaky = captured({ logs: [{ msg: "x", failure: new Error(LEAK_SENTINEL) }] });

    expect(await exposuresOf(leaky)).toHaveLength(1);
  });

  it("survives a circular structure", async () => {
    const circular: Record<string, unknown> = { msg: "x" };
    circular.self = circular;

    expect(await exposuresOf(captured({ logs: [circular] }))).toEqual([]);
  });

  it("looks for the sentinel it is given rather than the default", async () => {
    const leaky = captured({ logs: [{ msg: "x", answer: "OTHER_MARKER_1" }] });

    expect(await exposuresOf(leaky)).toEqual([]);
    expect(await exposuresOf(leaky, "OTHER_MARKER_1")).toHaveLength(1);
  });
});

function isRecording(): boolean {
  const span = trace.getTracer("probe").startSpan("probe");
  const recording = span.isRecording();
  span.end();
  return recording;
}

describe("leak-test runner: runLeakFlow", () => {
  const cleanFlow: LeakFlow<{ sessionId: string }> = {
    name: "logs a clean id",
    run: async ({ sessionId }) => {
      logger("execution").info("clean line", { sessionId });
    },
  };

  it("passes the world and the sentinel to the flow and returns what the exporters saw", async () => {
    const seen: string[] = [];
    const flow: LeakFlow<{ sessionId: string }> = {
      name: "records its inputs",
      run: async (world, sentinel) => {
        seen.push(world.sessionId, sentinel);
      },
    };

    await runLeakFlow(flow, { sessionId: SESSION_ID });

    expect(seen).toEqual([SESSION_ID, LEAK_SENTINEL]);
  });

  it("counts what each signal observed, so a flow that emits nothing is visible", async () => {
    const silent = await runLeakFlow({ name: "silent", run: async () => undefined }, {});
    const logged = await runLeakFlow(cleanFlow, { sessionId: SESSION_ID });

    expect(silent.observed).toEqual({ log: 0, span: 0, metric: 0 });
    expect(logged.observed).toEqual({ log: 1, span: 0, metric: 0 });
    expect(logged.exposures).toEqual([]);
  });

  it("lists the names of the spans the flow exported", async () => {
    const spanning: LeakFlow<object> = {
      name: "spans",
      run: async () => {
        await withSpan("session.submit", {}, async () => undefined);
      },
    };

    const run = await runLeakFlow(spanning, {});

    expect(run.spanNames).toEqual(["session.submit"]);
  });

  it("lists the messages of the log lines the flow wrote, and expectEmitted throws for one it did not write", async () => {
    const run = await runLeakFlow(cleanFlow, { sessionId: SESSION_ID });

    expect(run.logMessages).toEqual([expect.any(String)]);
    expect(() => expectEmitted("clean", run, run.logMessages)).not.toThrow();
    expect(() => expectEmitted("clean", run, ["session.completed"])).toThrow(/TELEMETRY LEAK TEST VACUOUS.*session\.completed/);
  });

  it("reports an exposure when the flow leaks through a channel the types alone guard", async () => {
    const leaky: LeakFlow<object> = {
      name: "casts the sentinel into a message",
      run: async (_world, sentinel) => {
        // eslint-disable-next-line local/no-cast-into-telemetry-text -- the negative control: a cast is the one way past the literal-only message type
        logger("execution").info(sentinel as "message");
      },
    };

    const run = await runLeakFlow(leaky, {});

    expect(run.exposures).toEqual([{ signal: "log", name: LEAK_SENTINEL }]);
  });

  it("tears the pipeline down after a flow, so nothing is recording afterwards", async () => {
    let recordingDuringFlow = false;
    const flow: LeakFlow<object> = {
      name: "checks the tracer",
      run: async () => {
        recordingDuringFlow = isRecording();
      },
    };

    await runLeakFlow(flow, {});

    expect(recordingDuringFlow).toBe(true);
    expect(isRecording()).toBe(false);
  });

  it("tears the pipeline down when the flow throws, and rethrows", async () => {
    const failing: LeakFlow<object> = {
      name: "throws",
      run: async () => {
        throw new Error("boom");
      },
    };

    await expect(runLeakFlow(failing, {})).rejects.toThrow("boom");
    expect(isRecording()).toBe(false);
  });
});

describe("leak-test assertion: expectCleanRun", () => {
  const clean = { exposures: [], observed: { log: 1, span: 0, metric: 0 }, spanNames: [], logMessages: [] };

  it("passes a run that emitted telemetry and leaked nothing", () => {
    expect(() => expectCleanRun("clean", clean)).not.toThrow();
  });

  it("throws a plain Error naming the flow, the signal and the leaking item", () => {
    const leaky = { exposures: [{ signal: "span" as const, name: "GET" }], observed: { log: 0, span: 1, metric: 0 }, spanNames: ["GET"], logMessages: [] };

    expect(() => expectCleanRun("leaky flow", leaky)).toThrow(/TELEMETRY LEAK TEST FAILED: "leaky flow".*span: GET/);
  });

  it("throws for a run that emitted nothing, so a silent flow cannot pass", () => {
    const silent = { exposures: [], observed: { log: 0, span: 0, metric: 0 }, spanNames: [], logMessages: [] };

    expect(() => expectCleanRun("silent flow", silent)).toThrow(/TELEMETRY LEAK TEST VACUOUS: "silent flow"/);
  });
});

describe("leak-test export-time scrub: a third-party span and counter that carry the sentinel", () => {
  const thirdParty: LeakFlow<object> = {
    name: "third-party telemetry",
    run: async (_world, sentinel) => {
      plantThirdPartyTelemetry(sentinel);
    },
  };

  afterEach(() => {
    vi.doUnmock("../src/exporters.js");
    vi.resetModules();
  });

  it("reaches no exporter through the real pipeline", async () => {
    const run = await runLeakFlow(thirdParty, {});

    expect(run.observed.span).toBeGreaterThan(0);
    expect(run.observed.metric).toBeGreaterThan(0);
    expect(() => expectCleanRun(thirdParty.name, run)).not.toThrow();
  });

  it("a bounded label that passes its shape check is exported, so the gate can see it leak", async () => {
    const run = await runLeakFlow(
      { name: "labelled counter", run: async (_world, sentinel) => plantThirdPartyCounter({ "db.constraint": sentinel.toLowerCase() }) },
      {},
    );

    expect(run.exposures.map((exposure) => exposure.signal)).toEqual(["metric"]);
  });

  it("a bounded label that fails its shape check is dropped", async () => {
    const run = await runLeakFlow(
      { name: "labelled counter", run: async (_world, sentinel) => plantThirdPartyCounter({ "db.constraint": sentinel }) },
      {},
    );

    expect(run.exposures).toEqual([]);
    expect(run.observed.metric).toBeGreaterThan(0);
  });

  it("mutation check: with the exporter scrub replaced by a pass-through, the same flow IS detected and the gate throws", async () => {
    vi.resetModules();
    vi.doMock("../src/exporters.js", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      scrubbingSpanExporter: (exporter: unknown) => exporter,
      scrubbingMetricExporter: (exporter: unknown) => exporter,
    }));
    const mutated = await import("../src/leak-test.js");

    const run = await mutated.runLeakFlow({ name: thirdParty.name, run: async (_world, sentinel) => mutated.plantThirdPartyTelemetry(sentinel) }, {});

    expect(new Set(run.exposures.map((exposure) => exposure.signal))).toEqual(new Set(["metric", "span"]));
    expect(run.exposures.filter((exposure) => exposure.signal === "span").length).toBeGreaterThanOrEqual(7);
    expect(() => mutated.expectCleanRun(thirdParty.name, run)).toThrow(/TELEMETRY LEAK TEST FAILED/);
  });
});
