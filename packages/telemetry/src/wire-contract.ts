import type { DomainEventField, DomainEventName } from "./events.js";
import { FIELDS, type FieldName } from "./fields.js";
import { isBrowserStack } from "./frame-shape.js";
import type { ClientLogEvent, IngestDropReason } from "./vocabulary.js";

export const BROWSER_DOMAIN_EVENTS = ["session.abandoned", "page.loaded"] as const satisfies readonly DomainEventName[];
export type BrowserDomainEvent = (typeof BROWSER_DOMAIN_EVENTS)[number];

type BrowserFieldRefusal = Extract<IngestDropReason, "unknown_field" | "invalid_field">;

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

const BROWSER_DOMAIN_FIELDS = {
  "session.abandoned": ["sessionId", "lastItemId"],
  "page.loaded": ["route", "durationMs"],
} as const satisfies { readonly [N in BrowserDomainEvent]: readonly (DomainEventField<N> & FieldName)[] };

const BROWSER_FIELDS = {
  "client.info": CLIENT_LOG_FIELDS,
  "client.warn": CLIENT_LOG_FIELDS,
  "client.error": CLIENT_LOG_FIELDS,
  ...BROWSER_DOMAIN_FIELDS,
} as const satisfies Record<ClientLogEvent | BrowserDomainEvent, readonly FieldName[]>;

export type BrowserEventName = keyof typeof BROWSER_FIELDS;

export function browserFieldsOf(name: string): readonly FieldName[] | undefined {
  return Object.entries(BROWSER_FIELDS).find(([known]) => known === name)?.[1];
}

export function browserDomainEventOf(name: unknown): BrowserDomainEvent | undefined {
  return BROWSER_DOMAIN_EVENTS.find((known) => known === name);
}

function acceptsFromBrowser(field: FieldName, value: unknown): boolean {
  return field === "errorStack" ? isBrowserStack(value) : FIELDS[field].accepts(value);
}

export function judgeBrowserField(eventName: string, key: string, value: unknown): FieldName | BrowserFieldRefusal {
  const field = browserFieldsOf(eventName)?.find((eligible) => eligible === key);
  if (field === undefined) return "unknown_field";
  return acceptsFromBrowser(field, value) ? field : "invalid_field";
}

export function keepsFromBrowser(eventName: string, field: FieldName, value: unknown): boolean {
  return judgeBrowserField(eventName, field, value) === field;
}
