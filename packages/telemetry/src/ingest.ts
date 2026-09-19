import { context, trace, type SpanContext } from "@opentelemetry/api";
import { telemetryApi } from "@qp/shared";
import { relayBrowserEvent } from "./events.js";
import type { FieldName } from "./fields.js";
import { guardedOr } from "./guard.js";
import { reportIngestDropped } from "./instruments.js";
import { relayLog } from "./logger.js";
import { parseTraceparent } from "./trace-context.js";
import { CLIENT_LOG_LEVELS, EVENT_SOURCES, type IngestDropReason } from "./vocabulary.js";
import { acceptsFromBrowser, browserDomainEventOf, browserFieldsOf, isClientLogEvent } from "./wire-contract.js";

const BROWSER_SOURCE: (typeof EVENT_SOURCES)[number] = "browser";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function traceparentOf(value: unknown): SpanContext | undefined {
  const parsed = parseTraceparent(value);
  return parsed === undefined ? undefined : { ...parsed, isRemote: true };
}

interface KeptFields {
  readonly kept: Record<string, unknown>;
  readonly unregistered: number;
  readonly rejected: number;
}

function keptFieldsOf(fields: Record<string, unknown>, eligible: readonly FieldName[]): KeptFields {
  const kept: Record<string, unknown> = {};
  let unregistered = 0;
  let rejected = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    const field = eligible.find((candidate) => candidate === key);
    if (field === undefined) {
      unregistered += 1;
    } else if (acceptsFromBrowser(field, value)) {
      kept[field] = value;
    } else {
      rejected += 1;
    }
  }
  return { kept, unregistered, rejected };
}

function refused(reason: IngestDropReason): false {
  reportIngestDropped(reason);
  return false;
}

function relay(name: string, fields: Record<string, unknown>): boolean {
  if (isClientLogEvent(name)) return relayLog(CLIENT_LOG_LEVELS[name], "browser", name, fields);
  const domainEvent = browserDomainEventOf(name);
  return domainEvent !== undefined && relayBrowserEvent(domainEvent, fields);
}

function withParent<T>(parent: SpanContext | undefined, fn: () => T): T {
  return parent === undefined ? fn() : context.with(trace.setSpanContext(context.active(), parent), fn);
}

function ingestEventUnguarded(raw: unknown, receivedAt: number): boolean {
  if (!isRecord(raw)) return refused("malformed");
  const { name, at, fields = {}, traceparent } = raw;
  if (typeof name !== "string" || typeof at !== "string" || Number.isNaN(Date.parse(at)) || !isRecord(fields)) {
    return refused("malformed");
  }
  const eligible = browserFieldsOf(name);
  if (eligible === undefined) return refused("unknown_event");

  const { kept, unregistered, rejected } = keptFieldsOf(fields, eligible);
  reportIngestDropped("unknown_field", unregistered);
  reportIngestDropped("invalid_field", rejected);
  const parent = traceparentOf(traceparent);
  if (traceparent !== undefined && parent === undefined) reportIngestDropped("invalid_trace");

  const stamped = { ...kept, source: BROWSER_SOURCE, eventAgeMs: Math.max(0, receivedAt - Date.parse(at)) };
  return withParent(parent, () => relay(name, stamped));
}

function ingestEvent(raw: unknown, receivedAt: number): boolean {
  return guardedOr("log", false, () => ingestEventUnguarded(raw, receivedAt));
}

export function ingestBatch(events: readonly unknown[], receivedAt: number): telemetryApi.TelemetryReceipt {
  return guardedOr("log", { accepted: 0, dropped: 0 }, () => {
    const considered = events.slice(0, telemetryApi.MAX_TELEMETRY_EVENTS);
    reportIngestDropped("over_limit", events.length - considered.length);
    const accepted = considered.filter((event) => ingestEvent(event, receivedAt)).length;
    return { accepted, dropped: events.length - accepted };
  });
}
