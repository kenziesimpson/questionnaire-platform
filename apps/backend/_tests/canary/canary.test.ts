import { withSpan, type SignalKind } from "@qp/telemetry";
import { expectCleanRun, plantThirdPartyCounter, runCanaryFlow } from "@qp/telemetry/canary";
import { describe, expect, it } from "vitest";
import { useTestDatabase } from "../db/fixtures.js";
import { canaryLog, CANARY_FLOWS, type BackendCanaryFlow } from "./flows.js";
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
        // eslint-disable-next-line no-restricted-syntax -- the negative control: a cast is the one way past the literal-only message type
        canaryLog.info(sentinel as "message");
      },
    },
  },
  {
    name: "a slug-shaped token placed in an item id",
    detectedIn: ["log", "span"],
    flow: {
      name: "leaks through an item id",
      run: async (_world, sentinel) => {
        await withSpan("session.submit", { itemId: sentinel.toLowerCase() }, async () => {
          canaryLog.info("inside the span", { itemId: sentinel.toLowerCase() });
        });
      },
    },
  },
  {
    name: "a route-shaped token placed in the route",
    detectedIn: ["log", "span"],
    flow: {
      name: "leaks through a route",
      run: async (_world, sentinel) => {
        await withSpan("session.submit", { route: `/${sentinel.toLowerCase()}` }, async () => {
          canaryLog.info("inside the span", { route: `/${sentinel.toLowerCase()}` });
        });
      },
    },
  },
  {
    name: "a constraint-shaped token placed on a metric label",
    detectedIn: ["metric"],
    flow: {
      name: "leaks through a metric label",
      run: async (_world, sentinel) => {
        plantThirdPartyCounter({ "db.constraint": sentinel.toLowerCase() });
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
