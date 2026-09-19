import { FIELDS } from "../fields.js";
import type { LiteralMessage, LogLevel, LogRecord } from "../logger.js";
import { scrubAttributes, type DropCounts } from "../scrub.js";
import { EVENTS_LOG_MODULE, LOG_ATTRIBUTES } from "../vocabulary.js";
import { browserDomainEventOf, type BrowserDomainEvent } from "../wire-contract.js";
import { safeFrames } from "./frames.js";

export const QUEUED_LEVELS = ["info", "warn", "error"] as const satisfies readonly LogLevel[];
export type QueuedLevel = (typeof QUEUED_LEVELS)[number];

interface EventStamp {
  readonly at: string;
  readonly traceparent: string | undefined;
}

export type QueuedEvent = Omit<LogRecord, "level"> & {
  readonly level: QueuedLevel;
  readonly at: string;
  readonly event?: BrowserDomainEvent;
  readonly traceparent?: string;
};

export interface EventRecord {
  readonly level: string;
  readonly message: unknown;
  readonly attributes?: unknown;
}

export type CallerAttributes = { readonly [attribute: string]: unknown; readonly "error.stack"?: never };

export interface CallerEvent<M extends string> {
  readonly level: QueuedLevel;
  readonly message: LiteralMessage<M>;
  readonly attributes?: CallerAttributes;
}

interface ScrubbedEvent {
  readonly event: QueuedEvent | undefined;
  readonly dropped: DropCounts;
}

const UNNAMED_MESSAGE = "unnamed";

const MESSAGE_SHAPE = /^[a-z][a-z0-9 ._:-]{0,79}$/;

function isQueuedLevel(level: string): level is QueuedLevel {
  return QUEUED_LEVELS.some((known) => known === level);
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
  const message = typeof input.message === "string" && MESSAGE_SHAPE.test(input.message) ? input.message : undefined;
  const dropped = { ...scrubbed.dropped, invalid: scrubbed.dropped.invalid + (message === undefined ? 1 : 0) };
  const { level } = input;
  if (!isQueuedLevel(level)) return { event: undefined, dropped };
  const domainEvent = scrubbed.attributes[LOG_ATTRIBUTES.module] === EVENTS_LOG_MODULE ? browserDomainEventOf(message) : undefined;
  return {
    event: {
      level,
      message: message ?? UNNAMED_MESSAGE,
      attributes: scrubbed.attributes,
      at: stamp.at,
      ...(domainEvent === undefined ? {} : { event: domainEvent }),
      ...(stamp.traceparent === undefined ? {} : { traceparent: stamp.traceparent }),
    },
    dropped,
  };
}
