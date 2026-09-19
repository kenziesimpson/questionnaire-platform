import { runningTelemetry } from "@qp/telemetry/node";
import { afterEach, describe, expect, it } from "vitest";
import { startBackendTelemetry, telemetryOfProcess, type ProcessTelemetry } from "../src/telemetry.js";

let started: ProcessTelemetry["handle"] | undefined;

afterEach(async () => {
  await started?.shutdown();
  started = undefined;
});

describe("telemetryOfProcess", () => {
  it("starts telemetry itself when the preload did not, and says so", () => {
    expect(runningTelemetry()).toBeUndefined();

    const telemetry = telemetryOfProcess();
    started = telemetry.handle;

    expect(telemetry.preloaded).toBe(false);
    expect(runningTelemetry()).toBe(telemetry.handle);
  });

  it("returns the handle the preload started rather than starting a second one", () => {
    started = startBackendTelemetry(false);

    const telemetry = telemetryOfProcess();

    expect(telemetry.preloaded).toBe(true);
    expect(telemetry.handle).toBe(started);
  });
});
