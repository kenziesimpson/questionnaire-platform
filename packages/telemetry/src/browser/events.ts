import { FIELDS } from "../fields.js";
import type { LogLevel, LogRecord } from "../logger.js";
import { scrubAttributes, type DropCounts } from "../scrub.js";

export const QUEUED_LEVELS = ["info", "warn", "error"] as const satisfies readonly LogLevel[];
export type QueuedLevel = (typeof QUEUED_LEVELS)[number];

export type QueuedEvent = Omit<LogRecord, "level"> & { readonly level: QueuedLevel };

export interface EventInput {
  readonly level: string;
  readonly message: string;
  readonly attributes?: unknown;
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

export function scrubbedEvent(input: EventInput, screen: string | undefined): ScrubbedEvent {
  const attributes = attributesOf(input.attributes);
  const screenAttribute = FIELDS.route.attribute;
  const scrubbed = scrubAttributes(
    screen === undefined || screenAttribute in attributes ? attributes : { ...attributes, [screenAttribute]: screen },
    "log",
  );
  const namedByShape = MESSAGE_SHAPE.test(input.message);
  const dropped = { ...scrubbed.dropped, invalid: scrubbed.dropped.invalid + (namedByShape ? 0 : 1) };
  const { level } = input;
  if (!isQueuedLevel(level)) return { event: undefined, dropped: scrubbed.dropped };
  return { event: { level, message: namedByShape ? input.message : UNNAMED_MESSAGE, attributes: scrubbed.attributes }, dropped };
}
