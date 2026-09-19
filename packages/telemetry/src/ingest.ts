import { context, isSpanContextValid, trace, type SpanContext } from "@opentelemetry/api";
import { telemetryApi } from "@qp/shared";
import { FIELDS, type FieldName } from "./fields.js";
import { isBrowserEvent, relayBrowserEvent } from "./events.js";
import { guardedOr } from "./guard.js";
import { isBrowserStack } from "./frame-shape.js";
import { reportIngestDropped } from "./instruments.js";
import { relayLog, type LogLevel } from "./logger.js";
import { CLIENT_LOG_EVENTS, EVENT_SOURCES, type ClientLogEvent, type IngestDropReason } from "./vocabulary.js";

const CLIENT_LOG_LEVELS = { "client.info": "info", "client.warn": "warn", "client.error": "error" } as const satisfies Record<
  ClientLogEvent,
  LogLevel
>;

const CLIENT_LOG_FIELDS = [
  "errorType",
  "errorStack",
  "route",
  "method",
  "sessionId",
  "questionnaireId",
  "questionnaireVersionId",
  "questionnaireVersion",
  "questionId",
  "questionType",
  "itemId",
  "lastItemId",
] as const satisfies readonly FieldName[];

const BROWSER_FIELDS = {
  "client.info": CLIENT_LOG_FIELDS,
  "client.warn": CLIENT_LOG_FIELDS,
  "client.error": CLIENT_LOG_FIELDS,
  "session.abandoned": ["sessionId", "questionnaireId", "questionnaireVersion", "lastItemId", "elapsedSeconds", "questionCount"],
} as const satisfies Record<ClientLogEvent | "session.abandoned", readonly FieldName[]>;

const BROWSER_SOURCE: (typeof EVENT_SOURCES)[number] = "browser";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClientLogEvent(name: string): name is ClientLogEvent {
  return CLIENT_LOG_EVENTS.some((known) => known === name);
}

function browserFieldsOf(name: string): readonly FieldName[] | undefined {
  return Object.entries(BROWSER_FIELDS).find(([known]) => known === name)?.[1];
}

function acceptsFromBrowser(field: FieldName, value: unknown): boolean {
  return field === "errorStack" ? isBrowserStack(value) : FIELDS[field].accepts(value);
}

function traceparentOf(value: unknown): SpanContext | undefined {
  const parts = typeof value === "string" ? TRACEPARENT.exec(value) : null;
  const [, traceId, spanId, flags] = parts ?? [];
  if (traceId === undefined || spanId === undefined || flags === undefined) return undefined;
  const parent = { traceId, spanId, traceFlags: Number.parseInt(flags, 16), isRemote: true };
  return isSpanContextValid(parent) ? parent : undefined;
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
  return isBrowserEvent(name) && relayBrowserEvent(name, fields);
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
  if (eligible === undefined || (!isClientLogEvent(name) && !isBrowserEvent(name))) return refused("unknown_event");

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
