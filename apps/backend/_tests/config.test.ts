import { DEFAULT_INGEST_EVENTS_PER_SECOND } from "@qp/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

async function configWith(value: string | undefined) {
  vi.resetModules();
  vi.stubEnv("TELEMETRY_INGEST_EVENTS_PER_SECOND", value ?? "");
  return (await import("../src/config.js")).config;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("config.ingestEventsPerSecond", () => {
  it("is the default when the variable is unset or empty", async () => {
    expect((await configWith(undefined)).ingestEventsPerSecond).toBe(DEFAULT_INGEST_EVENTS_PER_SECOND);
  });

  it("reads a whole number of at least two", async () => {
    expect((await configWith("2")).ingestEventsPerSecond).toBe(2);
    expect((await configWith("500")).ingestEventsPerSecond).toBe(500);
  });

  it.each(["1", "0", "-5", "2.5", "many"])("refuses %s, since a cap of one would leave no place for a log event beside the domain reserve", async (value) => {
    await expect(configWith(value)).rejects.toThrow("TELEMETRY_INGEST_EVENTS_PER_SECOND");
  });
});
