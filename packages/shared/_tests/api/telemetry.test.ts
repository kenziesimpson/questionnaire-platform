import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ProblemDetails } from "../../src/problems.js";
import * as telemetry from "../../src/api/telemetry.js";

describe("the telemetry route", () => {
  it("is one write under its own prefix, answering 202 with a receipt", () => {
    expect(telemetry.TELEMETRY_PREFIX).toBe("/api/telemetry");
    expect(telemetry.telemetryRoutes.map((route) => `${route.method} ${route.url}`)).toEqual(["POST /"]);
    expect(Object.keys(telemetry.ingestEvents.schema.response).sort()).toEqual(["202", "4xx", "5xx"]);
  });

  it("gives the problem body for 4xx and 5xx", () => {
    expect(telemetry.ingestEvents.schema.response["4xx"]).toBe(ProblemDetails);
    expect(telemetry.ingestEvents.schema.response["5xx"]).toBe(ProblemDetails);
  });
});

describe("the telemetry batch", () => {
  const body = telemetry.ingestEvents.schema.body;

  it("is an envelope of events, and accepts any event inside it, because the registry decides what is kept", () => {
    expect(Value.Check(body, { events: [] })).toBe(true);
    expect(Value.Check(body, { events: [{ name: "client.error", at: "2026-09-19T10:00:00.000Z", fields: { status: 500 } }] })).toBe(true);
    expect(Value.Check(body, { events: ["not an event", 7, null, { fields: 3 }] })).toBe(true);
    expect(Value.Check(body, { events: [], sentAt: "2026-09-19T10:00:00.000Z" })).toBe(true);
  });

  it.each([
    ["an empty body", undefined],
    ["a bare array", []],
    ["a string", "events"],
    ["an envelope with no events", {}],
    ["events that are not an array", { events: { name: "client.error" } }],
    ["events that are null", { events: null }],
  ])("is not an envelope: %s", (_name, value) => {
    expect(Value.Check(body, value)).toBe(false);
  });
});

describe("a telemetry event", () => {
  it("has a name, a timestamp, and optionally a traceparent and a bag of fields", () => {
    expect(Value.Check(telemetry.TelemetryEvent, { name: "session.abandoned", at: "2026-09-19T10:00:00.000Z" })).toBe(true);
    expect(
      Value.Check(telemetry.TelemetryEvent, {
        name: "session.abandoned",
        at: "2026-09-19T10:00:00.000Z",
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        fields: { sessionId: "5b1e7c2a-3d4f-4a6b-8c9d-0e1f2a3b4c5d", lastItemId: null },
      }),
    ).toBe(true);
  });

  it.each([
    ["no name", { at: "2026-09-19T10:00:00.000Z" }],
    ["no timestamp", { name: "client.info" }],
    ["fields that are not a bag", { name: "client.info", at: "2026-09-19T10:00:00.000Z", fields: "x" }],
  ])("is not one with %s", (_name, value) => {
    expect(Value.Check(telemetry.TelemetryEvent, value)).toBe(false);
  });
});

describe("the telemetry receipt", () => {
  it("counts accepted and dropped events and nothing else", () => {
    expect(Value.Check(telemetry.TelemetryReceipt, { accepted: 3, dropped: 0 })).toBe(true);
    expect(Value.Check(telemetry.TelemetryReceipt, { accepted: 3, dropped: 0, reasons: [] })).toBe(false);
    expect(Value.Check(telemetry.TelemetryReceipt, { accepted: -1, dropped: 0 })).toBe(false);
  });
});
