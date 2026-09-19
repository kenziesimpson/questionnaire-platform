import { logger, withSpan, type SignalKind } from "@qp/telemetry";
import { expectCleanRun, plantThirdPartyCounter } from "@qp/telemetry/leak-test";
import { describe, expect, it } from "vitest";
import { useTestDatabase } from "../db/fixtures.js";
import { SESSION_ID } from "../http/fixtures.js";
import { executionUrl } from "../modules/execution/fixtures.js";
import { leakLog, LEAK_FLOWS, type BackendLeakFlow } from "./flows.js";
import { runOnLeakApp } from "./harness.js";

const testDatabase = useTestDatabase();

const INSTRUMENTED = { autoInstrumentation: true };

const log = logger("execution");

const PLANTS_THIRD_PARTY_SPANS = "auto-instrumentation";

const runFlow = (flow: BackendLeakFlow) => runOnLeakApp(testDatabase, flow, INSTRUMENTED);

describe("TELEMETRY LEAK (CI gate): a planted answer value reaches no log, span or metric", () => {
  it("registers flows, each under its own name", () => {
    const names = LEAK_FLOWS.map((flow) => flow.name);

    expect(LEAK_FLOWS.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(LEAK_FLOWS.map((flow) => [flow.name, flow] as const))("leak-test flow: %s", async (_name, flow) => {
    const run = await runFlow(flow);

    expectCleanRun(flow.name, run);
    if (!flow.name.startsWith(PLANTS_THIRD_PARTY_SPANS)) {
      expect(run.spanNames, "a real span was exported under the unnamed placeholder").not.toContain("unnamed");
    }
  });
});

describe("TELEMETRY LEAK (CI gate): the pipeline it runs is the instrumented one", () => {
  it("exports the spans Fastify's instrumentation produces for a request on the real app, all under recognised names", async () => {
    const run = await runFlow({
      name: "a real request",
      run: async ({ app }) => {
        const response = await app.inject({ method: "GET", url: executionUrl(`/sessions/${SESSION_ID}`) });
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
      },
    });

    expect(run.spanNames).toContain("request");
    expect(run.spanNames).toContain("handler - handler");
    expect(run.spanNames).not.toContain("unnamed");
  });

  it("names every real span the health probes and an unknown route produce, so none is exported as unnamed", async () => {
    const run = await runFlow({
      name: "the health probes and an unknown route",
      run: async ({ app }) => {
        const statuses = [];
        for (const url of ["/health", "/health/live", "/health/ready", "/nope"]) {
          statuses.push((await app.inject({ method: "GET", url })).statusCode);
        }
        expect(statuses).toEqual([200, 200, 200, 404]);
      },
    });

    expect(run.spanNames).toEqual(expect.arrayContaining(["request", "handler - alive", "handler - ready", "notFoundHandler - replyNotFound"]));
    expect(run.spanNames).not.toContain("unnamed");
  });
});

interface NegativeControl {
  readonly name: string;
  readonly detectedIn: readonly SignalKind[];
  readonly flow: BackendLeakFlow;
}

const NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    name: "a sentinel cast into a log message",
    detectedIn: ["log"],
    flow: {
      name: "leaks through a log message",
      run: async (_world, sentinel) => {
        // eslint-disable-next-line local/no-cast-into-telemetry-text -- the negative control: a cast is the one way past the literal-only message type
        log.info(sentinel as "message");
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
          leakLog.info("inside the span", { itemId: sentinel.toLowerCase() });
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
          leakLog.info("inside the span", { route: `/${sentinel.toLowerCase()}` });
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

describe("TELEMETRY LEAK TEST negative control: the gate fails when a value does leak", () => {
  it.each(NEGATIVE_CONTROLS.map((control) => [control.name, control] as const))(
    "negative control: %s IS detected and the gate assertion throws",
    async (_name, control) => {
      const run = await runFlow(control.flow);

      expect(new Set(run.exposures.map((exposure) => exposure.signal))).toEqual(new Set(control.detectedIn));
      expect(() => expectCleanRun(control.flow.name, run)).toThrow(/TELEMETRY LEAK TEST FAILED/);
    },
  );

  it("negative control: a flow that emits nothing is rejected as vacuous rather than passing", async () => {
    const run = await runFlow({ name: "silent", run: async () => undefined });

    expect(run.exposures).toEqual([]);
    expect(() => expectCleanRun("silent", run)).toThrow(/TELEMETRY LEAK TEST VACUOUS/);
  });
});
