import { sensitive } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { CANARY_SENTINEL, exposuresOf, runCanaryFlow, type CanaryFlow, type CapturedTelemetry } from "../src/canary.js";
import { logger } from "../src/index.js";
import { installTestTelemetry } from "../src/testing.js";

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
      logs: [{ msg: "hello", "questionnaire.session_id": "s-1" }],
      spans: [{ attributes: { "questionnaire.id": "q-1" } }],
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
    ["a span status message", { status: { code: 2, message: CANARY_SENTINEL } }],
    ["a span resource", { resource: { attributes: { "service.name": CANARY_SENTINEL } } }],
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

describe("canary runner: runCanaryFlow", () => {
  const cleanFlow: CanaryFlow<{ sessionId: string }> = {
    name: "logs a clean id",
    run: async ({ sessionId }) => {
      logger("canary").info("clean line", { sessionId });
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

    await runCanaryFlow(flow, { sessionId: "s-1" });

    expect(seen).toEqual(["s-1", CANARY_SENTINEL]);
  });

  it("counts what each signal observed, so a flow that emits nothing is visible", async () => {
    const silent = await runCanaryFlow({ name: "silent", run: async () => undefined }, {});
    const logged = await runCanaryFlow(cleanFlow, { sessionId: "s-1" });

    expect(silent.observed).toEqual({ log: 0, span: 0, metric: 0 });
    expect(logged.observed).toEqual({ log: 1, span: 0, metric: 0 });
    expect(logged.exposures).toEqual([]);
  });

  it("reports an exposure when the flow leaks through a channel the types alone guard", async () => {
    const leaky: CanaryFlow<object> = {
      name: "casts the sentinel into a message",
      run: async (_world, sentinel) => {
        logger("canary").info(sentinel as "message");
      },
    };

    const run = await runCanaryFlow(leaky, {});

    expect(run.exposures).toEqual([{ signal: "log", name: CANARY_SENTINEL }]);
  });

  it("tears the pipeline down after a flow, so the next run starts empty", async () => {
    await runCanaryFlow(cleanFlow, { sessionId: "s-1" });
    const next = installTestTelemetry();
    try {
      expect(next.logs()).toEqual([]);
    } finally {
      await next.shutdown();
    }
  });

  it("tears the pipeline down when the flow throws, and rethrows", async () => {
    const failing: CanaryFlow<object> = {
      name: "throws",
      run: async () => {
        throw new Error("boom");
      },
    };

    await expect(runCanaryFlow(failing, {})).rejects.toThrow("boom");
    const next = installTestTelemetry();
    try {
      logger("canary").info("still works", { sessionId: "s-2" });
      expect(next.logs()).toHaveLength(1);
    } finally {
      await next.shutdown();
    }
  });
});
