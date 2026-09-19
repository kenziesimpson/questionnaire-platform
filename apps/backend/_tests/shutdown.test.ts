import { installTestTelemetry } from "@qp/telemetry/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shutDown, shutDownOnSignals, TELEMETRY_SHUTDOWN_TIMEOUT_MS, type ShutdownParts, type SignalSource } from "../src/shutdown.js";

const CANARY = "CANARY_DIABETES_8F3A";

afterEach(() => {
  vi.useRealTimers();
});

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
  it("closes the app, flushes telemetry, closes the pools, then shuts telemetry down last, and reports a clean exit", async () => {
    const order: string[] = [];

    await expect(shutDown(parts(order))).resolves.toBe(true);

    expect(order).toEqual(["app", "flush", "pools", "telemetry"]);
  });

  it("gives up on a stuck flush at the timeout, still closes the pools and shuts telemetry down, and reports a failure", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const stuck = parts(order, {
      telemetry: {
        flush: () => new Promise<void>(() => undefined),
        shutdown: async () => {
          order.push("telemetry");
        },
      },
    });

    const finished = shutDown(stuck);
    await vi.advanceTimersByTimeAsync(TELEMETRY_SHUTDOWN_TIMEOUT_MS);

    await expect(finished).resolves.toBe(false);
    expect(order).toEqual(["app", "pools", "telemetry"]);
  });

  it("still shuts telemetry down when the flush throws", async () => {
    const order: string[] = [];
    const broken = parts(order, {
      telemetry: {
        flush: async () => {
          throw new Error("flush failed");
        },
        shutdown: async () => {
          order.push("telemetry");
        },
      },
    });

    await expect(shutDown(broken)).resolves.toBe(false);

    expect(order).toEqual(["app", "pools", "telemetry"]);
  });

  it("carries on past a step that throws and reports a failure", async () => {
    const order: string[] = [];
    const broken = parts(order, {
      closeApp: async () => {
        throw new Error("close failed");
      },
    });

    await expect(shutDown(broken)).resolves.toBe(false);

    expect(order).toEqual(["flush", "pools", "telemetry"]);
  });

  it("logs a pool that does not close before telemetry shuts down, by error type and never its message, and reports a failure", async () => {
    const telemetry = installTestTelemetry();
    const order: string[] = [];
    const broken = parts(order, {
      closePools: async () => {
        throw new RangeError(`pool ${CANARY} refused to close`);
      },
    });

    await expect(shutDown(broken)).resolves.toBe(false);

    const failure = telemetry.logs().find((line) => line.msg === "closing the database pools failed");
    expect(failure).toMatchObject({ level: "error", "error.type": "RangeError" });
    expect(JSON.stringify(telemetry.logs())).not.toContain(CANARY);
    expect(order).toEqual(["app", "flush", "telemetry"]);
    await telemetry.shutdown();
  });
});

function fakeSignalSource() {
  const listeners = new Map<string, () => void>();
  const exits: number[] = [];
  const source: SignalSource = {
    on: (signal, listener) => listeners.set(signal, listener),
    exit: (code) => exits.push(code),
  };
  return { source, exits, emit: (signal: string) => listeners.get(signal)?.() };
}

describe("shutDownOnSignals", () => {
  it.each(["SIGINT", "SIGTERM"])("shuts down on %s and exits 0 when every step succeeded", async (signal) => {
    const order: string[] = [];
    const { source, exits, emit } = fakeSignalSource();
    shutDownOnSignals(parts(order), source);

    emit(signal);
    await vi.waitFor(() => expect(exits).toEqual([0]));

    expect(order).toEqual(["app", "flush", "pools", "telemetry"]);
  });

  it("exits 1 when a step failed", async () => {
    const { source, exits, emit } = fakeSignalSource();
    shutDownOnSignals(
      parts([], {
        closePools: async () => {
          throw new Error("pool close failed");
        },
      }),
      source,
    );

    emit("SIGTERM");
    await vi.waitFor(() => expect(exits).toEqual([1]));
  });

  it("runs the shutdown once and exits 1 at once on a second signal of either kind", async () => {
    const order: string[] = [];
    const { source, exits, emit } = fakeSignalSource();
    shutDownOnSignals(
      parts(order, {
        closeApp: () => new Promise<void>(() => undefined),
      }),
      source,
    );

    emit("SIGTERM");
    emit("SIGINT");

    expect(exits).toEqual([1]);
    expect(order).toEqual([]);
  });
});
