import { telemetryApi } from "@qp/shared";
import { fieldNameOfAttribute } from "../fields.js";
import { clientLogEventOf } from "../vocabulary.js";
import { browserDomainEventOf, keepsFromBrowser, type BrowserEventName } from "../wire-contract.js";
import { abandonmentsFirst, type QueuedEvent } from "./events.js";

export type WireEvent = telemetryApi.TelemetryEvent & { readonly name: BrowserEventName };

export interface WireEnvelope {
  readonly events: readonly WireEvent[];
}

export interface FetchInit {
  readonly method: "POST";
  readonly headers: { readonly "content-type": string };
  readonly body: string;
}

export const BEACON_BODY_BUDGET_BYTES = telemetryApi.MAX_TELEMETRY_BODY_BYTES / 2;

const JSON_CONTENT_TYPE = "application/json";

const EMPTY_ENVELOPE_BYTES = jsonBytes({ events: [] });

const SEPARATOR_BYTES = 1;

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function nameOf(event: QueuedEvent): BrowserEventName {
  return browserDomainEventOf(event.event) ?? clientLogEventOf(event.level);
}

function fieldsOf(name: BrowserEventName, attributes: QueuedEvent["attributes"]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [attribute, value] of Object.entries(attributes)) {
    const field = fieldNameOfAttribute(attribute);
    if (field !== undefined && keepsFromBrowser(name, field, value)) fields[field] = value;
  }
  return fields;
}

export function toWireEvent(event: QueuedEvent): WireEvent {
  const name = nameOf(event);
  const fields = fieldsOf(name, event.attributes);
  return {
    name,
    at: event.at,
    ...(event.traceparent === undefined ? {} : { traceparent: event.traceparent }),
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
  };
}

export function toEnvelopes(events: readonly QueuedEvent[], maxBytes: number = telemetryApi.MAX_TELEMETRY_BODY_BYTES): WireEnvelope[] {
  const envelopes: WireEnvelope[] = [];
  let current: WireEvent[] = [];
  let bytes = EMPTY_ENVELOPE_BYTES;
  for (const wire of abandonmentsFirst(events).map(toWireEvent)) {
    const size = jsonBytes(wire);
    const separator = current.length === 0 ? 0 : SEPARATOR_BYTES;
    const full = current.length >= telemetryApi.MAX_TELEMETRY_EVENTS || bytes + size + separator > maxBytes;
    if (current.length > 0 && full) {
      envelopes.push({ events: current });
      current = [];
      bytes = EMPTY_ENVELOPE_BYTES + size;
    } else {
      bytes += size + separator;
    }
    current.push(wire);
  }
  if (current.length > 0) envelopes.push({ events: current });
  return envelopes;
}

export function toBeaconBlob(envelope: WireEnvelope): Blob {
  return new Blob([JSON.stringify(envelope)], { type: JSON_CONTENT_TYPE });
}

export function toFetchInit(envelope: WireEnvelope): FetchInit {
  return { method: "POST", headers: { "content-type": JSON_CONTENT_TYPE }, body: JSON.stringify(envelope) };
}
