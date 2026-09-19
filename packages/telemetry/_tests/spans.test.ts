import { context, trace, type Span } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeTraceId, annotateActiveSpan, withSpan } from "../src/index.js";
import { installTestTelemetry, type TestTelemetry } from "../src/testing.js";
import { installFaultyMeter, internalDropsIn, internalDropsOf, restoreFaults } from "./faults.js";
import { SESSION_ID } from "./fixtures.js";

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  restoreFaults();
  await telemetry?.shutdown();
  telemetry = undefined;
});

function stubbedSpan(): Span {
  const tracer = trace.getTracer("probe");
  const span = tracer.startSpan("probe");
  vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
  vi.spyOn(tracer, "startSpan").mockReturnValue(span);
  return span;
}

function failEnd(span: Span): void {
  vi.spyOn(span, "end").mockImplementation(() => {
    throw new Error("end failed");
  });
}

function failSetStatus(span: Span): void {
  vi.spyOn(span, "setStatus").mockImplementation(() => {
    throw new Error("setStatus failed");
  });
}

function failSetAttributes(span: Span): void {
  vi.spyOn(span, "setAttributes").mockImplementation(() => {
    throw new Error("setAttributes failed");
  });
}

const STARTUP_FAILURES: [string, () => void][] = [
  [
    "getTracer throws",
    () => {
      vi.spyOn(trace, "getTracer").mockImplementation(() => {
        throw new Error("no tracer");
      });
    },
  ],
  [
    "startSpan throws",
    () => {
      const tracer = trace.getTracer("probe");
      vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
      vi.spyOn(tracer, "startSpan").mockImplementation(() => {
        throw new Error("no span");
      });
    },
  ],
];

describe("withSpan never throws or hangs because of the SDK", () => {
  it.each(STARTUP_FAILURES)("runs the callback once and returns its value when %s", async (_name, arrange) => {
    const recorded = installFaultyMeter();
    arrange();
    let calls = 0;
    const result = await withSpan("session.submit", { sessionId: SESSION_ID }, async () => {
      calls += 1;
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toBe(1);
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it.each(STARTUP_FAILURES)("still rethrows the callback's own error, once, when %s", async (_name, arrange) => {
    const recorded = installFaultyMeter();
    arrange();
    const failure = new Error("business failure");
    let calls = 0;
    await expect(
      withSpan("session.submit", {}, async () => {
        calls += 1;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("runs the callback once and returns its value when the context manager throws", async () => {
    const recorded = installFaultyMeter();
    stubbedSpan();
    vi.spyOn(context, "with").mockImplementation(() => {
      throw new Error("no context");
    });
    let calls = 0;
    const result = await withSpan("session.submit", {}, async () => {
      calls += 1;
      return "done";
    });
    expect(result).toBe("done");
    expect(calls).toBe(1);
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("returns the callback's value when ending the span throws", async () => {
    const recorded = installFaultyMeter();
    failEnd(stubbedSpan());
    await expect(withSpan("session.submit", {}, async () => "done")).resolves.toBe("done");
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("rethrows the callback's own error, not the SDK's, when marking the span failed and ending it both throw", async () => {
    const recorded = installFaultyMeter();
    const span = stubbedSpan();
    failSetStatus(span);
    failSetAttributes(span);
    failEnd(span);
    const failure = new TypeError("business failure");
    await expect(
      withSpan("session.submit", {}, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(internalDropsOf(recorded)).toEqual(["span", "span", "span"]);
  });

  it("rethrows a callback error whose name getter throws, unchanged", async () => {
    const recorded = installFaultyMeter();
    stubbedSpan();
    const failure = new Error("business failure");
    Object.defineProperty(failure, "name", {
      get: () => {
        throw new Error("hostile name");
      },
    });
    await expect(
      withSpan("session.submit", {}, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("starts a span with no attributes, returns the value and counts one internal drop when the context has a throwing getter", async () => {
    telemetry = installTestTelemetry();
    const hostile = {
      sessionId: SESSION_ID,
      get itemId(): string {
        throw new Error("hostile");
      },
    };
    const result = await withSpan("session.submit", hostile, async () => "done");
    expect(result).toBe("done");
    const [span] = telemetry.spans();
    expect(span?.name).toBe("session.submit");
    expect(span?.attributes).toEqual({});
    expect(await internalDropsIn(telemetry)).toEqual({ span: 1 });
  });
});

describe("the active-span helpers never throw", () => {
  it("activeTraceId is undefined when reading the active span throws", () => {
    const recorded = installFaultyMeter();
    vi.spyOn(trace, "getActiveSpan").mockImplementation(() => {
      throw new Error("no active span");
    });
    expect(activeTraceId()).toBeUndefined();
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("annotateActiveSpan returns normally when reading the active span throws", () => {
    const recorded = installFaultyMeter();
    vi.spyOn(trace, "getActiveSpan").mockImplementation(() => {
      throw new Error("no active span");
    });
    expect(() => {
      annotateActiveSpan({ sessionId: SESSION_ID }, new Error("x"));
    }).not.toThrow();
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("annotateActiveSpan returns normally when setting the attributes throws", () => {
    const recorded = installFaultyMeter();
    const span = stubbedSpan();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);
    failSetAttributes(span);
    expect(() => {
      annotateActiveSpan({ sessionId: SESSION_ID });
    }).not.toThrow();
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("annotateActiveSpan attaches nothing, and counts the failure, when the context has a throwing getter", () => {
    const recorded = installFaultyMeter();
    const span = stubbedSpan();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);
    const setAttributes = vi.spyOn(span, "setAttributes");
    const hostile = {
      sessionId: SESSION_ID,
      get itemId(): string {
        throw new Error("hostile");
      },
    };
    expect(() => {
      annotateActiveSpan(hostile);
    }).not.toThrow();
    expect(setAttributes).not.toHaveBeenCalled();
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("annotateActiveSpan attaches nothing when the error's name getter throws", () => {
    const recorded = installFaultyMeter();
    const span = stubbedSpan();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);
    const setAttributes = vi.spyOn(span, "setAttributes");
    const hostile = new Error("x");
    Object.defineProperty(hostile, "name", {
      get: () => {
        throw new Error("hostile name");
      },
    });
    expect(() => {
      annotateActiveSpan({ sessionId: SESSION_ID }, hostile);
    }).not.toThrow();
    expect(setAttributes).not.toHaveBeenCalled();
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });
});
