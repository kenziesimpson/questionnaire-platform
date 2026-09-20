import { afterEach, describe, expect, it } from "vitest";
import { logger, withSpan } from "../src/index.js";
import { configureLogging } from "../src/logger.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
});

describe("installTestTelemetry: internalDrops", () => {
  it("is zero after telemetry that all succeeded", async () => {
    telemetry = installTestTelemetry();
    logger("execution").info("clean line");
    await withSpan("session.submit", {}, async () => undefined);
    expect(await telemetry.internalDrops()).toBe(0);
  });

  it("counts each call that failed and was swallowed, and leaves the other drop reasons out", async () => {
    telemetry = installTestTelemetry();
    configureLogging({
      level: "debug",
      sink: () => {
        throw new Error("sink failed");
      },
    });
    logger("execution").info("swallowed once");
    logger("execution").warn("swallowed twice");
    // @ts-expect-error — the closed context rejects an unknown field at compile time; the scrub drops it as unknown, not internal
    await withSpan("session.submit", { value: "x" }, async () => undefined);
    expect(await telemetry.internalDrops()).toBe(2);
  });
});
