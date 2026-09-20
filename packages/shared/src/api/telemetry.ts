import Type, { type Static } from "typebox";
import { NonNegativeInt, strict } from "../primitives.js";
import { defineRoute } from "./route.js";

export const TELEMETRY_PREFIX = "/api/telemetry";

export const MAX_TELEMETRY_EVENTS = 50;

export const MAX_TELEMETRY_BODY_BYTES = 65_536;

export const TelemetryEvent = Type.Object({
  name: Type.String(),
  at: Type.String(),
  traceparent: Type.Optional(Type.String()),
  fields: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type TelemetryEvent = Static<typeof TelemetryEvent>;

export const TelemetryBatch = Type.Object({ events: Type.Array(Type.Unknown()) });
export type TelemetryBatch = Static<typeof TelemetryBatch>;

export const TelemetryReceipt = Type.Object({ accepted: NonNegativeInt, dropped: NonNegativeInt }, strict);
export type TelemetryReceipt = Static<typeof TelemetryReceipt>;

export const ingestEvents = defineRoute({
  method: "POST",
  url: "/",
  schema: { body: TelemetryBatch, response: { 202: TelemetryReceipt } },
});

export const telemetryRoutes = [ingestEvents] as const;
