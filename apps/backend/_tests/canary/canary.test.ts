import { logger, withSpan, type SpanName, type TelemetryContext } from "@qp/telemetry";
import { CANARY_SENTINEL, runCanaryFlow, type CanaryRun } from "@qp/telemetry/canary";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { requestLogger } from "../../src/http/request-logger.js";
import { useTestDatabase } from "../db/fixtures.js";
import { CANARY_FLOWS, type BackendCanaryFlow, type CanaryWorld } from "./flows.js";

const testDatabase = useTestDatabase();

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({
    logger: requestLogger("debug"),
    definition: { database: testDatabase.database("definition") },
    execution: { database: testDatabase.database("execution") },
    reporting: { reporting: testDatabase.database("reporting") },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function world(): CanaryWorld {
  return { app, testDatabase };
}

function expectCleanRun(flowName: string, run: CanaryRun): void {
  const leaks = run.exposures.map((exposure) => `${exposure.signal}: ${exposure.name}`);
  expect(leaks, `TELEMETRY CANARY FAILED: "${flowName}" let the sentinel ${CANARY_SENTINEL} reach telemetry`).toEqual([]);
  const observed = run.observed.log + run.observed.span + run.observed.metric;
  expect(observed, `TELEMETRY CANARY VACUOUS: "${flowName}" emitted no telemetry, so it proves nothing`).toBeGreaterThan(0);
}

describe("TELEMETRY CANARY (CI gate): a planted answer value reaches no log, span or metric", () => {
  it("registers each flow under its own name", () => {
    const names = CANARY_FLOWS.map((flow) => flow.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it.each(CANARY_FLOWS.map((flow) => [flow.name, flow] as const))("canary flow: %s", async (_name, flow) => {
    expectCleanRun(flow.name, await runCanaryFlow(flow, world()));
  });
});

const log = logger("canary");

interface NegativeControl {
  readonly name: string;
  readonly detectedIn: readonly ("log" | "span" | "metric")[];
  readonly flow: BackendCanaryFlow;
}

function idForged(sentinel: string): TelemetryContext {
  return Object.assign<TelemetryContext, Record<string, unknown>>({}, { sessionId: sentinel });
}

const NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    name: "a sentinel cast into a log message",
    detectedIn: ["log"],
    flow: {
      name: "leaks through a log message",
      run: async (_world, sentinel) => {
        log.info(sentinel as "message");
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
        await withSpan("session.submit", idForged(sentinel), async () => {
          log.info("inside the span", idForged(sentinel));
        });
      },
    },
  },
];

describe("TELEMETRY CANARY negative control: the gate fails when a value does leak", () => {
  it.each(NEGATIVE_CONTROLS.map((control) => [control.name, control] as const))(
    "negative control: %s IS detected and the gate assertion throws",
    async (_name, control) => {
      const run = await runCanaryFlow(control.flow, world());

      expect(new Set(run.exposures.map((exposure) => exposure.signal))).toEqual(new Set(control.detectedIn));
      expect(() => expectCleanRun(control.flow.name, run)).toThrow(/TELEMETRY CANARY FAILED/);
    },
  );

  it("negative control: a flow that emits nothing is rejected as vacuous rather than passing", async () => {
    const run = await runCanaryFlow({ name: "silent", run: async () => undefined }, world());

    expect(run.exposures).toEqual([]);
    expect(() => expectCleanRun("silent", run)).toThrow(/TELEMETRY CANARY VACUOUS/);
  });
});
