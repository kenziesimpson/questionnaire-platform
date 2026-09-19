import { afterEach, describe, expect, it } from "vitest";
import { guarded, guardedOr } from "../src/guard.js";
import { DROPPED_COUNTER, installFaultyMeter, internalDropsOf, restoreFaults } from "./faults.js";

const LEAK = "LEAK_DIABETES_8F3A";

afterEach(restoreFaults);

describe("guarded", () => {
  it("runs the action once and returns normally", () => {
    const recorded = installFaultyMeter();
    let runs = 0;
    guarded("log", () => {
      runs += 1;
    });
    expect(runs).toBe(1);
    expect(recorded).toEqual([]);
  });

  it("swallows a throw and counts it as an internal drop of the given signal, never recording its message", () => {
    const recorded = installFaultyMeter();
    expect(() =>
      guarded("span", () => {
        throw new Error(`failed ${LEAK}`);
      }),
    ).not.toThrow();
    expect(recorded).toEqual([{ name: DROPPED_COUNTER, value: 1, attributes: { "telemetry.signal": "span", "telemetry.reason": "internal" } }]);
    expect(JSON.stringify(recorded)).not.toContain(LEAK);
  });

  it("still returns normally when the drop counter is itself unavailable", () => {
    const recorded = installFaultyMeter({ unavailable: true });
    expect(() =>
      guarded("log", () => {
        throw new Error("failed");
      }),
    ).not.toThrow();
    expect(recorded).toEqual([]);
  });
});

const THROWN: [string, unknown][] = [
  ["undefined", undefined],
  ["a string", "x"],
  ["an object with no prototype", Object.create(null)],
  [
    "a proxy whose traps throw",
    new Proxy(
      {},
      {
        get: () => {
          throw new Error("hostile get");
        },
        getPrototypeOf: () => {
          throw new Error("hostile prototype");
        },
      },
    ),
  ],
];

describe("what an action throws", () => {
  it.each(THROWN)("guarded swallows %s and counts one internal drop", (_name, thrown) => {
    const recorded = installFaultyMeter();
    expect(() =>
      guarded("log", () => {
        throw thrown;
      }),
    ).not.toThrow();
    expect(internalDropsOf(recorded)).toEqual(["log"]);
  });

  it.each(THROWN)("guardedOr returns its fallback for %s", (_name, thrown) => {
    installFaultyMeter();
    expect(
      guardedOr("metric", "fallback", (): string => {
        throw thrown;
      }),
    ).toBe("fallback");
  });
});

describe("guardedOr", () => {
  it("returns the action's value", () => {
    installFaultyMeter();
    expect(guardedOr("log", "fallback", () => "value")).toBe("value");
  });

  it("returns the fallback and counts an internal drop when the action throws", () => {
    const recorded = installFaultyMeter();
    const result = guardedOr("log", "fallback", (): string => {
      throw new Error("failed");
    });
    expect(result).toBe("fallback");
    expect(internalDropsOf(recorded)).toEqual(["log"]);
  });
});
