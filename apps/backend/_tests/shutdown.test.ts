import { describe, expect, it, vi } from "vitest";
import { shutDown, TELEMETRY_SHUTDOWN_TIMEOUT_MS, type ShutdownParts } from "../src/shutdown.js";

function parts(order: string[], overrides: Partial<ShutdownParts> = {}): ShutdownParts {
  return {
    closeApp: async () => {
      order.push("app");
    },
    telemetry: {
      flush: async () => {
        order.push("flush");
      },
      shutdown: async () => {
        order.push("telemetry");
      },
    },
    closePools: async () => {
      order.push("pools");
    },
    ...overrides,
  };
}

describe("shutDown", () => {
  it("closes the app, flushes and shuts down telemetry, then closes the pools, and reports a clean exit", async () => {
    const order: string[] = [];

    await expect(shutDown(parts(order))).resolves.toBe(true);

    expect(order).toEqual(["app", "flush", "telemetry", "pools"]);
  });

  it("does not wait forever on telemetry: it gives up at the timeout, still closes the pools and reports a failure", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const stuck = parts(order, {
      telemetry: { flush: () => new Promise<void>(() => undefined), shutdown: async () => undefined },
    });

    const finished = shutDown(stuck);
    await vi.advanceTimersByTimeAsync(TELEMETRY_SHUTDOWN_TIMEOUT_MS);

    await expect(finished).resolves.toBe(false);
    expect(order).toEqual(["app", "pools"]);
    vi.useRealTimers();
  });

  it("carries on past a step that throws and reports a failure", async () => {
    const order: string[] = [];
    const broken = parts(order, {
      closeApp: async () => {
        throw new Error("close failed");
      },
    });

    await expect(shutDown(broken)).resolves.toBe(false);

    expect(order).toEqual(["flush", "telemetry", "pools"]);
  });

  it("reports a failure when the pools do not close", async () => {
    const order: string[] = [];
    const broken = parts(order, {
      closePools: async () => {
        throw new Error("pool close failed");
      },
    });

    await expect(shutDown(broken)).resolves.toBe(false);
  });
});
