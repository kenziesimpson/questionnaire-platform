import { afterEach, describe, expect, it } from "vitest";
import { incrementCounter, recordSessionDuration, reportDropped } from "../src/instruments.js";
import { oneDropped } from "../src/scrub.js";
import { DROPPED_COUNTER, installFaultyMeter, internalDropsOf, restoreFaults } from "./faults.js";

afterEach(restoreFaults);

describe("instruments record normally", () => {
  it("adds one to a named counter with its attributes", () => {
    const recorded = installFaultyMeter();
    incrementCounter("questionnaire.created", { "questionnaire.outcome": "accepted" });
    expect(recorded).toEqual([{ name: "questionnaire.created", value: 1, attributes: { "questionnaire.outcome": "accepted" } }]);
  });

  it("adds the amount it is given to a named counter", () => {
    const recorded = installFaultyMeter();
    incrementCounter("questionnaire.answers.rejected", { "questionnaire.reason": "answer/required" }, 35);
    expect(recorded).toEqual([{ name: "questionnaire.answers.rejected", value: 35, attributes: { "questionnaire.reason": "answer/required" } }]);
  });

  it("records a session duration", () => {
    const recorded = installFaultyMeter();
    recordSessionDuration(1200);
    expect(recorded).toEqual([{ name: "questionnaire.session.duration", value: 1200, attributes: undefined }]);
  });

  it("counts each dropped reason by signal, and nothing when nothing was dropped", () => {
    const recorded = installFaultyMeter();
    reportDropped("log", { unknown: 0, invalid: 0, unbounded: 0, internal: 0 });
    reportDropped("metric", { unknown: 0, invalid: 2, unbounded: 1, internal: 0 });
    expect(recorded.map((entry) => [entry.value, entry.attributes])).toEqual([
      [2, { "telemetry.signal": "metric", "telemetry.reason": "invalid" }],
      [1, { "telemetry.signal": "metric", "telemetry.reason": "unbounded" }],
    ]);
  });
});

describe("instruments never throw", () => {
  it("swallows a counter that throws and counts one internal metric drop", () => {
    const recorded = installFaultyMeter({ failing: ["questionnaire.created"] });
    expect(() => {
      incrementCounter("questionnaire.created", {});
    }).not.toThrow();
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });

  it("swallows a counter that throws when adding an amount, and counts one internal metric drop", () => {
    const recorded = installFaultyMeter({ failing: ["questionnaire.answers.rejected"] });
    expect(() => {
      incrementCounter("questionnaire.answers.rejected", {}, 35);
    }).not.toThrow();
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });

  it("swallows a histogram that throws and counts one internal metric drop", () => {
    const recorded = installFaultyMeter({ failing: ["questionnaire.session.duration"] });
    expect(() => {
      recordSessionDuration(1200);
    }).not.toThrow();
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });

  it("swallows a getMeter that throws, for a counter, a histogram and a drop report", () => {
    const recorded = installFaultyMeter({ unavailable: true });
    expect(() => {
      incrementCounter("questionnaire.created", {});
      recordSessionDuration(1200);
      reportDropped("log", oneDropped("invalid"));
      reportDropped("log", oneDropped("internal"));
    }).not.toThrow();
    expect(recorded).toEqual([]);
  });

  it("swallows a drop counter that throws, even when it is the counter that would record the failure", () => {
    const recorded = installFaultyMeter({ failing: [DROPPED_COUNTER] });
    expect(() => {
      reportDropped("span", oneDropped("invalid"));
    }).not.toThrow();
    expect(recorded).toEqual([]);
  });
});
