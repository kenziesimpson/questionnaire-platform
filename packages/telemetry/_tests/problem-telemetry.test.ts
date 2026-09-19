import { problem } from "@qp/shared";
import { afterEach, describe, expect, it } from "vitest";
import { problemTelemetry } from "../src/index.js";
import { installFaultyMeter, internalDropsOf, restoreFaults } from "./faults.js";

afterEach(restoreFaults);

describe("problemTelemetry never throws into the caller", () => {
  it("projects a problem as before when nothing fails", () => {
    const recorded = installFaultyMeter();
    expect(problemTelemetry(problem("questionnaire/closed"))).toEqual([{ problem: "questionnaire/closed", status: 409 }]);
    expect(recorded).toEqual([]);
  });

  it("returns no findings, and counts one internal log drop, when reading the body throws", () => {
    const recorded = installFaultyMeter();
    const body = problem("questionnaire/closed");
    Object.defineProperty(body, "type", {
      get: () => {
        throw new Error("hostile type");
      },
    });
    expect(problemTelemetry(body)).toEqual([]);
    expect(internalDropsOf(recorded)).toEqual(["log"]);
  });

  it("returns no findings when a finding's items throw while being read", () => {
    const recorded = installFaultyMeter();
    const body = problem("submission/invalid", { items: [{ itemId: "itm_01", code: "answer/required" }] });
    Object.defineProperty(body, "items", {
      get: () => {
        throw new Error("hostile items");
      },
    });
    expect(problemTelemetry(body)).toEqual([]);
    expect(internalDropsOf(recorded)).toEqual(["log"]);
  });

  it("returns normally when getMeter throws as well", () => {
    installFaultyMeter({ unavailable: true });
    const body = problem("questionnaire/closed");
    Object.defineProperty(body, "status", {
      get: () => {
        throw new Error("hostile status");
      },
    });
    expect(problemTelemetry(body)).toEqual([]);
  });
});
