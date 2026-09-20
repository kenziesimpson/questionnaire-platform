import { isSpanContextValid, trace } from "@opentelemetry/api";
import { guardedOr } from "../guard.js";
import { formatTraceparent, TRACEPARENT_HEADER } from "../trace-context.js";

type HeaderPairs = readonly (readonly [string, string])[];

interface HeaderMap {
  forEach(callback: (value: string, name: string) => void): void;
}

export type HeadersInput = Readonly<Record<string, string>> | HeaderPairs | HeaderMap;

const HEADER_VALUE_SEPARATOR = ", ";

function isPairs(headers: HeadersInput): headers is HeaderPairs {
  return Array.isArray(headers);
}

function isHeaderMap(headers: Exclude<HeadersInput, HeaderPairs>): headers is HeaderMap {
  return typeof Reflect.get(headers, "forEach") === "function";
}

function entriesOf(headers: HeadersInput): (readonly [string, string])[] {
  if (isPairs(headers)) return [...headers];
  if (!isHeaderMap(headers)) return Object.entries(headers);
  const entries: (readonly [string, string])[] = [];
  headers.forEach((value, name) => {
    entries.push([name, value]);
  });
  return entries;
}

function withoutTraceparent(headers: HeadersInput): Record<string, string> {
  const merged = new Map<string, { readonly name: string; readonly value: string }>();
  for (const [name, value] of entriesOf(headers)) {
    const key = name.toLowerCase();
    if (key === TRACEPARENT_HEADER) continue;
    const existing = merged.get(key);
    merged.set(key, { name: existing?.name ?? name, value: existing === undefined ? value : `${existing.value}${HEADER_VALUE_SEPARATOR}${value}` });
  }
  return Object.fromEntries([...merged.values()].map(({ name, value }) => [name, value]));
}

export function activeTraceparent(): string | undefined {
  return guardedOr<string | undefined>("span", undefined, () => {
    const active = trace.getActiveSpan()?.spanContext();
    return active === undefined || !isSpanContextValid(active) ? undefined : formatTraceparent(active.traceId, active.spanId, active.traceFlags);
  });
}

export function injectTraceHeaders(headers: HeadersInput = {}): Record<string, string> {
  const traceparent = activeTraceparent();
  const others = withoutTraceparent(headers);
  return traceparent === undefined ? others : { ...others, [TRACEPARENT_HEADER]: traceparent };
}
