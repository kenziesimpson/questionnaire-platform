import { withSpan, type SignalKind, type SpanName } from "@qp/telemetry";
import { expectCleanRun, runCanaryFlow } from "@qp/telemetry/canary";
import { describe, expect, it } from "vitest";
import { useTestDatabase } from "../db/fixtures.js";
import { canaryLog, CANARY_FLOWS, forgedContext, type BackendCanaryFlow } from "./flows.js";
import { useCanaryWorld } from "./harness.js";

const testDatabase = useTestDatabase();
const world = useCanaryWorld(testDatabase);

const INSTRUMENTED = { autoInstrumentation: true };

describe("TELEMETRY CANARY (CI gate): a planted answer value reaches no log, span or metric", () => {
  it("registers flows, each under its own name", () => {
    const names = CANARY_FLOWS.map((flow) => flow.name);

    expect(CANARY_FLOWS.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(CANARY_FLOWS.map((flow) => [flow.name, flow] as const))("canary flow: %s", async (_name, flow) => {
    expectCleanRun(flow.name, await runCanaryFlow(flow, world(), INSTRUMENTED));
  });
});

interface NegativeControl {
  readonly name: string;
  readonly detectedIn: readonly SignalKind[];
  readonly flow: BackendCanaryFlow;
}

const NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    name: "a sentinel cast into a log message",
    detectedIn: ["log"],
    flow: {
      name: "leaks through a log message",
      run: async (_world, sentinel) => {
        canaryLog.info(sentinel as "message");
      },
    },
  },
  {
    name: "a sentinel cast into a span name",
    detectedIn: ["span"],
    flow: {
      name: "leaks through a span name",
      run: async (_world, sentinel) => {
        await withSpan(sentinel as SpanName, {}, async () => undefined);
      },
    },
  },
  {
    name: "an answer-shaped token placed in an id field",
    detectedIn: ["log", "span"],
    flow: {
      name: "leaks through an id field",
      run: async (_world, sentinel) => {
        await withSpan("session.submit", forgedContext({ sessionId: sentinel }), async () => {
          canaryLog.info("inside the span", forgedContext({ sessionId: sentinel }));
        });
      },
    },
  },
];

describe("TELEMETRY CANARY negative control: the gate fails when a value does leak", () => {
  it.each(NEGATIVE_CONTROLS.map((control) => [control.name, control] as const))(
    "negative control: %s IS detected and the gate assertion throws",
    async (_name, control) => {
      const run = await runCanaryFlow(control.flow, world(), INSTRUMENTED);

      expect(new Set(run.exposures.map((exposure) => exposure.signal))).toEqual(new Set(control.detectedIn));
      expect(() => expectCleanRun(control.flow.name, run)).toThrow(/TELEMETRY CANARY FAILED/);
    },
  );

  it("negative control: a flow that emits nothing is rejected as vacuous rather than passing", async () => {
    const run = await runCanaryFlow({ name: "silent", run: async () => undefined }, world(), INSTRUMENTED);

    expect(run.exposures).toEqual([]);
    expect(() => expectCleanRun("silent", run)).toThrow(/TELEMETRY CANARY VACUOUS/);
  });
});
