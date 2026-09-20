import { context } from "@opentelemetry/api";
import { telemetryApi } from "@qp/shared";
import { clientTraceIdOf, withClientTrace } from "./client-trace.js";
import { relayBrowserEvent } from "./events.js";
import { guardedOr } from "./guard.js";
import type { IngestCapacity, IngestEventKind } from "./ingest-capacity.js";
import { reportIngestDropped } from "./instruments.js";
import { relayLog } from "./logger.js";
import { clientLogEventOf, clientLogLevelOf, EVENT_SOURCES, type IngestDropReason } from "./vocabulary.js";
import { browserDomainEventOf, browserFieldsOf, judgeBrowserField } from "./wire-contract.js";

const BROWSER_SOURCE: (typeof EVENT_SOURCES)[number] = "browser";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface KeptFields {
  readonly kept: Record<string, unknown>;
  readonly unregistered: number;
  readonly rejected: number;
}

function keptFieldsOf(fields: Record<string, unknown>, eventName: string): KeptFields {
  const kept: Record<string, unknown> = {};
  let unregistered = 0;
  let rejected = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    const verdict = judgeBrowserField(eventName, key, value);
    if (verdict === "unknown_field") unregistered += 1;
    else if (verdict === "invalid_field") rejected += 1;
    else kept[verdict] = value;
  }
  return { kept, unregistered, rejected };
}

function refused(reason: IngestDropReason): false {
  reportIngestDropped(reason);
  return false;
}

function relay(name: string, fields: Record<string, unknown>): boolean {
  const level = clientLogLevelOf(name);
  if (level !== undefined) return relayLog(level, "browser", clientLogEventOf(level), fields);
  const domainEvent = browserDomainEventOf(name);
  return domainEvent !== undefined && relayBrowserEvent(domainEvent, fields);
}

function withClientTraceId<T>(clientTraceId: string | undefined, fn: () => T): T {
  return context.with(withClientTrace(context.active(), clientTraceId), fn);
}

function kindOf(name: string): IngestEventKind {
  return clientLogLevelOf(name) === undefined ? "domain" : "log";
}

function ingestEventUnguarded(raw: unknown, receivedAt: number, capacity: IngestCapacity | undefined): boolean {
  if (!isRecord(raw)) return refused("malformed");
  const { name, at, fields = {}, traceparent } = raw;
  if (typeof name !== "string" || typeof at !== "string" || Number.isNaN(Date.parse(at)) || !isRecord(fields)) {
    return refused("malformed");
  }
  if (browserFieldsOf(name) === undefined) return refused("unknown_event");
  if (capacity !== undefined && !capacity.admit(kindOf(name), receivedAt)) return refused("over_capacity");

  const { kept, unregistered, rejected } = keptFieldsOf(fields, name);
  reportIngestDropped("unknown_field", unregistered);
  reportIngestDropped("invalid_field", rejected);
  const clientTraceId = clientTraceIdOf(traceparent);
  if (traceparent !== undefined && clientTraceId === undefined) reportIngestDropped("invalid_trace");

  const stamped = { ...kept, source: BROWSER_SOURCE, eventAgeMs: Math.max(0, receivedAt - Date.parse(at)) };
  return withClientTraceId(clientTraceId, () => relay(name, stamped));
}

function ingestEvent(raw: unknown, receivedAt: number, capacity: IngestCapacity | undefined): boolean {
  return guardedOr("log", false, () => ingestEventUnguarded(raw, receivedAt, capacity));
}

export function ingestBatch(events: readonly unknown[], receivedAt: number, capacity?: IngestCapacity): telemetryApi.TelemetryReceipt {
  return guardedOr("log", { accepted: 0, dropped: 0 }, () => {
    const considered = events.slice(0, telemetryApi.MAX_TELEMETRY_EVENTS);
    reportIngestDropped("over_limit", events.length - considered.length);
    const accepted = considered.filter((event) => ingestEvent(event, receivedAt, capacity)).length;
    return { accepted, dropped: events.length - accepted };
  });
}
