import { withSpan } from "@qp/telemetry";
import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditTraceId } from "../../src/http/trace.js";

const TRACE_ID = /^[0-9a-f]{32}$/;

let telemetry: TestTelemetry;

beforeEach(() => {
  telemetry = installTestTelemetry();
});

afterEach(async () => {
  await telemetry.shutdown();
});

describe("auditTraceId", () => {
  it("is null when no span is active, so an audit row records that it has no trace", () => {
    expect(auditTraceId()).toBeNull();
  });

  it("is the trace id of the active span", async () => {
    const seen = await withSpan("questionnaire.publish", {}, async () => auditTraceId());

    const [span] = telemetry.spans();
    expect(seen).toMatch(TRACE_ID);
    expect(seen).toBe(span?.spanContext().traceId);
  });
});
