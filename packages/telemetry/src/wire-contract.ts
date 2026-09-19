import type { DomainEventName } from "./events.js";
import { FIELDS, type FieldName } from "./fields.js";
import { isBrowserStack } from "./frame-shape.js";
import { CLIENT_LOG_EVENTS, type ClientLogEvent } from "./vocabulary.js";

export const BROWSER_DOMAIN_EVENTS = ["session.abandoned"] as const satisfies readonly DomainEventName[];
export type BrowserDomainEvent = (typeof BROWSER_DOMAIN_EVENTS)[number];

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
} as const satisfies Record<ClientLogEvent | BrowserDomainEvent, readonly FieldName[]>;

export type BrowserEventName = keyof typeof BROWSER_FIELDS;

export function browserFieldsOf(name: string): readonly FieldName[] | undefined {
  return Object.entries(BROWSER_FIELDS).find(([known]) => known === name)?.[1];
}

export function isClientLogEvent(name: string): name is ClientLogEvent {
  return CLIENT_LOG_EVENTS.some((known) => known === name);
}

export function browserDomainEventOf(name: unknown): BrowserDomainEvent | undefined {
  return BROWSER_DOMAIN_EVENTS.find((known) => known === name);
}

export function acceptsFromBrowser(field: FieldName, value: unknown): boolean {
  return field === "errorStack" ? isBrowserStack(value) : FIELDS[field].accepts(value);
}
