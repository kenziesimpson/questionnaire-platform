import { FIELDS } from "../fields.js";
import type { LiteralMessage, LogRecord } from "../logger.js";
import { scrubAttributes, type DropCounts } from "../scrub.js";
import { BROWSER_MESSAGE_SHAPE, CLIENT_LOG_LEVELS, LOG_ATTRIBUTES, UNNAMED, type ClientLogLevel } from "../vocabulary.js";
import { browserDomainEventOf, type BrowserDomainEvent } from "../wire-contract.js";
import { safeFrames } from "./frames.js";

interface EventStamp {
  readonly at: string;
  readonly traceparent: string | undefined;
  readonly isDomainEvent: boolean;
}

export type QueuedEvent = Omit<LogRecord, "level"> & {
  readonly level: ClientLogLevel;
  readonly at: string;
  readonly event?: BrowserDomainEvent;
  readonly traceparent?: string;
};

export interface EventRecord {
  readonly level: string;
  readonly message: unknown;
  readonly attributes?: unknown;
}

export type CallerAttributes = { readonly [attribute: string]: unknown; readonly "error.stack"?: never; readonly module?: never };

export interface CallerEvent<M extends string> {
  readonly level: ClientLogLevel;
  readonly message: LiteralMessage<M>;
  readonly attributes?: CallerAttributes;
}

interface ScrubbedEvent {
  readonly event: QueuedEvent | undefined;
  readonly dropped: DropCounts;
}

function isClientLogLevel(level: string): level is ClientLogLevel {
  return CLIENT_LOG_LEVELS.some((known) => known === level);
}

function attributesOf(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? { ...input } : {};
}

function withSafeStack(attributes: Record<string, unknown>): Record<string, unknown> {
  const key = FIELDS.errorStack.attribute;
  const stack = attributes[key];
  return typeof stack === "string" ? { ...attributes, [key]: safeFrames(stack) } : attributes;
}

export function scrubbedEvent(input: EventRecord, screen: string | undefined, stamp: EventStamp): ScrubbedEvent {
  const attributes = withSafeStack(attributesOf(input.attributes));
  const screenAttribute = FIELDS.route.attribute;
  const scrubbed = scrubAttributes(
    screen === undefined || screenAttribute in attributes ? attributes : { ...attributes, [screenAttribute]: screen },
    "log",
  );
  const message = typeof input.message === "string" && BROWSER_MESSAGE_SHAPE.test(input.message) ? input.message : undefined;
  const dropped = { ...scrubbed.dropped, invalid: scrubbed.dropped.invalid + (message === undefined ? 1 : 0) };
  const { level } = input;
  if (!isClientLogLevel(level)) return { event: undefined, dropped };
  const domainEvent = stamp.isDomainEvent ? browserDomainEventOf(message) : undefined;
  return {
    event: {
      level,
      message: message ?? UNNAMED,
      attributes: scrubbed.attributes,
      at: stamp.at,
      ...(domainEvent === undefined ? {} : { event: domainEvent }),
      ...(stamp.traceparent === undefined ? {} : { traceparent: stamp.traceparent }),
    },
    dropped,
  };
}

export function callerRecord<M extends string>(event: CallerEvent<M>): EventRecord {
  const attributes = Object.entries(attributesOf(event.attributes)).filter(([key]) => key !== LOG_ATTRIBUTES.module);
  return { level: event.level, message: event.message, attributes: Object.fromEntries(attributes) };
}

export function domainEventsFirst(events: readonly QueuedEvent[]): QueuedEvent[] {
  const isAbandonment = (event: QueuedEvent): boolean => browserDomainEventOf(event.event) !== undefined;
  return [...events.filter(isAbandonment), ...events.filter((event) => !isAbandonment(event))];
}
