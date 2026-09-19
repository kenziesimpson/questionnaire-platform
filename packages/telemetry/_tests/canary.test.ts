import { SpanStatusCode, trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { sensitive } from "@qp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANARY_SENTINEL,
  expectCleanRun,
  exposuresOf,
  plantThirdPartyCounter,
  plantThirdPartyTelemetry,
  runCanaryFlow,
  type CanaryFlow,
  type CapturedTelemetry,
} from "../src/canary.js";
import { logger } from "../src/index.js";
import { installTestTelemetry } from "../src/testing.js";
import { SESSION_ID, QUESTIONNAIRE_ID } from "./fixtures.js";

function captured(parts: Partial<{ logs: Record<string, unknown>[]; spans: object[]; metrics: object[] }> = {}): CapturedTelemetry {
  return {
    logs: () => parts.logs ?? [],
    spans: () => (parts.spans ?? []).map((span) => ({ name: "a span", ...span })),
    metrics: async () => (parts.metrics ?? []).map((metric) => ({ descriptor: { name: "a.metric" }, ...metric })),
  };
}

describe("canary detector: exposuresOf", () => {
  it("reports nothing for telemetry that never saw the sentinel", async () => {
    const clean = captured({
      logs: [{ msg: "hello", "questionnaire.session_id": SESSION_ID }],
      spans: [{ attributes: { "questionnaire.id": QUESTIONNAIRE_ID } }],
      metrics: [{ dataPoints: [{ attributes: { "questionnaire.reason": "answer/required" }, value: 3 }] }],
    });

    expect(await exposuresOf(clean)).toEqual([]);
  });

  it("finds the sentinel in a log line, by message", async () => {
    const leaky = captured({ logs: [{ msg: "session submitted", answer: CANARY_SENTINEL }] });

    expect(await exposuresOf(leaky)).toEqual([{ signal: "log", name: "session submitted" }]);
  });

  it.each([
    ["a span attribute", { attributes: { "questionnaire.item_id": CANARY_SENTINEL } }],
    ["a span attribute key", { attributes: { [CANARY_SENTINEL]: 1 } }],
    ["a span event", { events: [{ name: "note", attributes: { detail: CANARY_SENTINEL } }] }],
    ["a span link", { links: [{ attributes: { detail: CANARY_SENTINEL } }] }],
    ["a span status message", { status: { code: SpanStatusCode.ERROR, message: CANARY_SENTINEL } }],
    ["a span resource", { resource: { attributes: { "service.name": CANARY_SENTINEL } } }],
    ["a real resource", { resource: resourceFromAttributes({ "service.name": CANARY_SENTINEL }) }],
    ["a Map", { attributes: new Map([["detail", CANARY_SENTINEL]]) }],
    ["a Set", { attributes: new Set([CANARY_SENTINEL]) }],
    ["a span name", { name: `publish ${CANARY_SENTINEL}` }],
  ])("finds the sentinel in %s", async (_where, span) => {
    const exposures = await exposuresOf(captured({ spans: [span] }));

    expect(exposures.map((exposure) => exposure.signal)).toEqual(["span"]);
  });

  it.each([
    ["a data point attribute", { dataPoints: [{ attributes: { reason: CANARY_SENTINEL }, value: 1 }] }],
    ["a metric description", { descriptor: { name: "a.metric", description: CANARY_SENTINEL } }],
    ["a histogram bucket key", { dataPoints: [{ attributes: {}, value: { buckets: { [CANARY_SENTINEL]: 1 } } }] }],
  ])("finds the sentinel in a metric's %s", async (_where, metric) => {
    const exposures = await exposuresOf(captured({ metrics: [metric] }));

    expect(exposures).toEqual([{ signal: "metric", name: "a.metric" }]);
  });

  it("matches regardless of case, so a lowercased answer is still caught", async () => {
    const leaky = captured({ logs: [{ msg: "x", answer: CANARY_SENTINEL.toLowerCase() }] });

    expect(await exposuresOf(leaky)).toHaveLength(1);
  });

  it("reports each signal that carries it", async () => {
    const leaky = captured({
      logs: [{ msg: "a", answer: CANARY_SENTINEL }],
      spans: [{ attributes: { answer: CANARY_SENTINEL } }],
      metrics: [{ dataPoints: [{ attributes: { answer: CANARY_SENTINEL } }] }],
    });

    expect((await exposuresOf(leaky)).map((exposure) => exposure.signal)).toEqual(["log", "span", "metric"]);
  });

  it("does not count a Sensitive wrapper, which serializes as redacted", async () => {
    const wrapped = captured({ logs: [{ msg: "x", answer: sensitive(CANARY_SENTINEL) }] });

    expect(await exposuresOf(wrapped)).toEqual([]);
  });

  it("finds the sentinel in an error's message even though JSON would hide it", async () => {
    const leaky = captured({ logs: [{ msg: "x", failure: new Error(CANARY_SENTINEL) }] });

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

describe("canary runner: runCanaryFlow", () => {
  const cleanFlow: CanaryFlow<{ sessionId: string }> = {
    name: "logs a clean id",
    run: async ({ sessionId }) => {
      logger("execution").info("clean line", { sessionId });
    },
  };

  it("passes the world and the sentinel to the flow and returns what the exporters saw", async () => {
    const seen: string[] = [];
    const flow: CanaryFlow<{ sessionId: string }> = {
      name: "records its inputs",
      run: async (world, sentinel) => {
        seen.push(world.sessionId, sentinel);
      },
    };

    await runCanaryFlow(flow, { sessionId: SESSION_ID });

    expect(seen).toEqual([SESSION_ID, CANARY_SENTINEL]);
  });

  it("counts what each signal observed, so a flow that emits nothing is visible", async () => {
    const silent = await runCanaryFlow({ name: "silent", run: async () => undefined }, {});
    const logged = await runCanaryFlow(cleanFlow, { sessionId: SESSION_ID });

    expect(silent.observed).toEqual({ log: 0, span: 0, metric: 0 });
    expect(logged.observed).toEqual({ log: 1, span: 0, metric: 0 });
    expect(logged.exposures).toEqual([]);
  });

  it("reports an exposure when the flow leaks through a channel the types alone guard", async () => {
    const leaky: CanaryFlow<object> = {
      name: "casts the sentinel into a message",
      run: async (_world, sentinel) => {
        // eslint-disable-next-line no-restricted-syntax -- the negative control: a cast is the one way past the literal-only message type
        logger("execution").info(sentinel as "message");
      },
    };

    const run = await runCanaryFlow(leaky, {});

    expect(run.exposures).toEqual([{ signal: "log", name: CANARY_SENTINEL }]);
  });

  it("tears the pipeline down after a flow, so nothing is recording afterwards", async () => {
    let recordingDuringFlow = false;
    const flow: CanaryFlow<object> = {
      name: "checks the tracer",
      run: async () => {
        recordingDuringFlow = isRecording();
      },
    };

    await runCanaryFlow(flow, {});

    expect(recordingDuringFlow).toBe(true);
    expect(isRecording()).toBe(false);
  });

  it("tears the pipeline down when the flow throws, and rethrows", async () => {
    const failing: CanaryFlow<object> = {
      name: "throws",
      run: async () => {
        throw new Error("boom");
      },
    };

    await expect(runCanaryFlow(failing, {})).rejects.toThrow("boom");
    expect(isRecording()).toBe(false);
  });
});

describe("canary assertion: expectCleanRun", () => {
  const clean = { exposures: [], observed: { log: 1, span: 0, metric: 0 } };

  it("passes a run that emitted telemetry and leaked nothing", () => {
    expect(() => expectCleanRun("clean", clean)).not.toThrow();
  });

  it("throws a plain Error naming the flow, the signal and the leaking item", () => {
    const leaky = { exposures: [{ signal: "span" as const, name: "GET" }], observed: { log: 0, span: 1, metric: 0 } };

    expect(() => expectCleanRun("leaky flow", leaky)).toThrow(/TELEMETRY CANARY FAILED: "leaky flow".*span: GET/);
  });

  it("throws for a run that emitted nothing, so a silent flow cannot pass", () => {
    const silent = { exposures: [], observed: { log: 0, span: 0, metric: 0 } };

    expect(() => expectCleanRun("silent flow", silent)).toThrow(/TELEMETRY CANARY VACUOUS: "silent flow"/);
  });
});

describe("canary export-time scrub: a third-party span and counter that carry the sentinel", () => {
  const thirdParty: CanaryFlow<object> = {
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
    const run = await runCanaryFlow(thirdParty, {});

    expect(run.observed.span).toBeGreaterThan(0);
    expect(run.observed.metric).toBeGreaterThan(0);
    expect(() => expectCleanRun(thirdParty.name, run)).not.toThrow();
  });

  it("a bounded label that passes its shape check is exported, so the gate can see it leak", async () => {
    const run = await runCanaryFlow(
      { name: "labelled counter", run: async (_world, sentinel) => plantThirdPartyCounter({ "db.constraint": sentinel.toLowerCase() }) },
      {},
    );

    expect(run.exposures.map((exposure) => exposure.signal)).toEqual(["metric"]);
  });

  it("a bounded label that fails its shape check is dropped", async () => {
    const run = await runCanaryFlow(
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
    const mutated = await import("../src/canary.js");

    const run = await mutated.runCanaryFlow({ name: thirdParty.name, run: async (_world, sentinel) => mutated.plantThirdPartyTelemetry(sentinel) }, {});

    expect(run.exposures.map((exposure) => exposure.signal).sort()).toEqual(["metric", "span", "span", "span"]);
    expect(() => mutated.expectCleanRun(thirdParty.name, run)).toThrow(/TELEMETRY CANARY FAILED/);
  });
});
