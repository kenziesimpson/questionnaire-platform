import { logger, withSpan, type SignalKind } from "@qp/telemetry";
import { expectCleanRun, expectEmitted, plantThirdPartyCounter } from "@qp/telemetry/leak-test";
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
    expectEmitted(flow.name, run, flow.emits ?? []);
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

describe("TELEMETRY LEAK (CI gate): the pipeline it runs patches the pg driver the app loaded", () => {
  it("exports pg query and pool connect spans under recognised names, the operation-duration histogram and each pool's gauges", async () => {
    const run = await runFlow({
      name: "real statements on a pool and a client",
      run: async (world) => {
        await world.testDatabase.pool("execution").query("SELECT 1");
        await (await world.testDatabase.connect("reporting")).query("SELECT 1");
      },
    });

    expect(run.spanNames).toEqual(expect.arrayContaining(["pg.query:SELECT", "pg-pool.connect", "pg.connect"]));
    expect(run.spanNames).not.toContain("unnamed");
    expect(run.metricNames).toEqual(
      expect.arrayContaining([
        "db.client.operation.duration",
        "db.pool.connections.total",
        "db.pool.connections.idle",
        "db.pool.connections.waiting",
      ]),
    );
  });

  it("does not count the ambient pool gauges as a flow's own metrics", async () => {
    const run = await runFlow({ name: "a flow that emits nothing", run: async () => undefined });

    expect(run.metricNames).toContain("db.pool.connections.total");
    expect(run.observed.metric).toBe(0);
  });

  it("does not count a flow's queries as its own telemetry, so a flow that only touches the database is vacuous", async () => {
    const touchesTheDatabase: BackendLeakFlow = {
      name: "a flow whose target path emits nothing but which queries",
      run: async (world) => {
        await world.testDatabase.pool("execution").query("SELECT 1");
      },
    };

    const run = await runFlow(touchesTheDatabase);

    expect(run.spanNames).toContain("pg.query:SELECT");
    expect(run.metricNames).toContain("db.client.operation.duration");
    expect(run.observed).toEqual({ log: 0, span: 0, metric: 0 });
    expect(() => expectCleanRun(touchesTheDatabase.name, run)).toThrow(/TELEMETRY LEAK TEST VACUOUS/);
  });

  it("counts them when the flow declares that it observes the database", async () => {
    const observesTheDatabase: BackendLeakFlow = {
      name: "a flow that is about the database",
      observesDatabase: true,
      run: async (world) => {
        await world.testDatabase.pool("execution").query("SELECT 1");
      },
    };

    const run = await runFlow(observesTheDatabase);

    expect(run.observed.span).toBeGreaterThan(0);
    expect(run.observed.metric).toBeGreaterThan(0);
    expect(() => expectCleanRun(observesTheDatabase.name, run)).not.toThrow();
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
