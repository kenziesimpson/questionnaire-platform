import { describe, expect, it } from "vitest";
import { formatTraceparent, parseTraceparent, SPAN_ID_LENGTH, TRACE_FLAGS_LENGTH, TRACE_ID_LENGTH, TRACEPARENT_VERSION } from "../src/trace-context.js";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

const SPAN_ID = "b7ad6b7169203331";

function hex(length: number, seed: number): string {
  return Array.from({ length }, (_, index) => ((seed * 31 + index * 7 + 1) % 15) + 1)
    .map((digit) => digit.toString(16))
    .join("");
}

describe("formatTraceparent", () => {
  it("writes the version, the trace id, the span id and two hex digits of flags", () => {
    expect(formatTraceparent(TRACE_ID, SPAN_ID, 1)).toBe(`${TRACEPARENT_VERSION}-${TRACE_ID}-${SPAN_ID}-01`);
    expect(formatTraceparent(TRACE_ID, SPAN_ID, 0)).toBe(`${TRACEPARENT_VERSION}-${TRACE_ID}-${SPAN_ID}-00`);
    expect(formatTraceparent(TRACE_ID, SPAN_ID, 255)).toBe(`${TRACEPARENT_VERSION}-${TRACE_ID}-${SPAN_ID}-ff`);
  });

  it("keeps the flags to one byte, whatever the number handed in", () => {
    expect(formatTraceparent(TRACE_ID, SPAN_ID, 257).split("-")[3]).toHaveLength(TRACE_FLAGS_LENGTH);
  });
});

describe("parseTraceparent: the ingest reads back what the SDK wrote", () => {
  it.each([0, 1, 2, 3, 16, 128, 255])("returns the same ids and flags for flags %i", (flags) => {
    expect(parseTraceparent(formatTraceparent(TRACE_ID, SPAN_ID, flags))).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: flags });
  });

  it("round-trips a spread of generated ids", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const traceId = hex(TRACE_ID_LENGTH, seed);
      const spanId = hex(SPAN_ID_LENGTH, seed + 100);

      expect(parseTraceparent(formatTraceparent(traceId, spanId, seed % 2))).toEqual({ traceId, spanId, traceFlags: seed % 2 });
    }
  });
});

describe("parseTraceparent: what it refuses", () => {
  const valid = formatTraceparent(TRACE_ID, SPAN_ID, 1);

  it.each([
    ["uppercase hex", valid.toUpperCase()],
    ["a short trace id", `00-${TRACE_ID.slice(1)}-${SPAN_ID}-01`],
    ["a long trace id", `00-${TRACE_ID}0-${SPAN_ID}-01`],
    ["a short span id", `00-${TRACE_ID}-${SPAN_ID.slice(1)}-01`],
    ["a long span id", `00-${TRACE_ID}-${SPAN_ID}0-01`],
    ["a one-digit flags field", `00-${TRACE_ID}-${SPAN_ID}-1`],
    ["a three-digit flags field", `00-${TRACE_ID}-${SPAN_ID}-001`],
    ["version ff", `ff-${TRACE_ID}-${SPAN_ID}-01`],
    ["a future version", `01-${TRACE_ID}-${SPAN_ID}-01`],
    ["an all-zero trace id", `00-${"0".repeat(TRACE_ID_LENGTH)}-${SPAN_ID}-01`],
    ["an all-zero span id", `00-${TRACE_ID}-${"0".repeat(SPAN_ID_LENGTH)}-01`],
    ["non-hex characters", `00-${"g".repeat(TRACE_ID_LENGTH)}-${SPAN_ID}-01`],
    ["a trailing field", `${valid}-extra`],
    ["surrounding whitespace", ` ${valid} `],
    ["an empty string", ""],
  ])("refuses %s", (_label, value) => {
    expect(parseTraceparent(value)).toBeUndefined();
  });

  it.each([undefined, null, 7, {}])("refuses a value that is not a string: %j", (value) => {
    expect(parseTraceparent(value)).toBeUndefined();
  });
});
