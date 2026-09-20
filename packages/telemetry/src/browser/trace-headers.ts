import { guardedOr } from "../guard.js";
import { ALL_ZERO, formatTraceparent, SPAN_ID_LENGTH, TRACE_ID_LENGTH, TRACEPARENT_HEADER } from "../trace-context.js";

type HeaderPairs = readonly (readonly [string, string])[];

interface HeaderMap {
  forEach(callback: (value: string, name: string) => void): void;
}

export type HeadersInput = Readonly<Record<string, string>> | HeaderPairs | HeaderMap;

const HEADER_VALUE_SEPARATOR = ", ";

const NOT_SAMPLED = 0;

const HEX_DIGITS_PER_BYTE = 2;

const HEX_RADIX = 16;

let pageTraceId: string | undefined;

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

function randomHex(length: number): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length / HEX_DIGITS_PER_BYTE));
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0")).join("");
}

function randomId(length: number): string {
  let id = randomHex(length);
  while (ALL_ZERO.test(id)) id = randomHex(length);
  return id;
}

function pageTrace(): string {
  pageTraceId ??= randomId(TRACE_ID_LENGTH);
  return pageTraceId;
}

export function pageTraceparent(): string | undefined {
  return guardedOr<string | undefined>("span", undefined, () => formatTraceparent(pageTrace(), randomId(SPAN_ID_LENGTH), NOT_SAMPLED));
}

export function injectTraceHeaders(headers: HeadersInput = {}): Record<string, string> {
  const traceparent = pageTraceparent();
  const others = withoutTraceparent(headers);
  return traceparent === undefined ? others : { ...others, [TRACEPARENT_HEADER]: traceparent };
}
