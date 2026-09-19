import type { DropCounts } from "../scrub.js";
import { DROP_REASONS, type DropReason } from "../vocabulary.js";
import { scrubbedEvent, type CallerEvent, type EventRecord, type QueuedEvent } from "./events.js";

const EVENT_DROP_REASONS = ["overflow", "undelivered", "internal", "level"] as const;
export type EventDropReason = (typeof EVENT_DROP_REASONS)[number];

const DEFAULT_MAX_PENDING = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

export interface EventQueueOptions {
  readonly send: (events: readonly QueuedEvent[]) => void | Promise<void>;
  readonly beacon: (events: readonly QueuedEvent[]) => boolean;
  readonly screen?: () => string | undefined;
  readonly maxPending?: number;
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
}

export interface QueueStats {
  readonly pending: number;
  readonly sent: number;
  readonly droppedEvents: Readonly<Record<EventDropReason, number>>;
  readonly droppedFields: DropCounts;
}

export interface EventQueue {
  enqueue<M extends string>(event: CallerEvent<M>): void;
  enqueueRecord(record: EventRecord): void;
  flush(): void;
  flushOnExit(): void;
  close(): void;
  stats(): QueueStats;
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function addDropped(total: Record<DropReason, number>, more: DropCounts): void {
  for (const reason of DROP_REASONS) total[reason] += more[reason];
}

export function createEventQueue(options: EventQueueOptions): EventQueue {
  const maxPending = positiveIntegerOr(options.maxPending, DEFAULT_MAX_PENDING);
  const batchSize = Math.min(positiveIntegerOr(options.batchSize, DEFAULT_BATCH_SIZE), maxPending);
  const flushIntervalMs = positiveIntegerOr(options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS);
  const pending: QueuedEvent[] = [];
  const droppedEvents: Record<EventDropReason, number> = { overflow: 0, undelivered: 0, internal: 0, level: 0 };
  const droppedFields: Record<DropReason, number> = { unknown: 0, invalid: 0, unbounded: 0, internal: 0 };
  let sent = 0;
  let inFlight = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stopTimer(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  function startTimer(): void {
    if (closed) return;
    timer ??= setTimeout(() => {
      timer = undefined;
      flush();
    }, flushIntervalMs);
  }

  function screenNow(): string | undefined {
    try {
      return options.screen?.();
    } catch {
      return undefined;
    }
  }

  function settle(count: number, delivered: boolean): void {
    inFlight = false;
    if (delivered) sent += count;
    else droppedEvents.undelivered += count;
    if (closed) return;
    if (pending.length >= batchSize) flush();
    else if (pending.length > 0) startTimer();
  }

  function flush(): void {
    if (closed || inFlight) return;
    const batch = pending.splice(0, batchSize);
    if (batch.length === 0) return;
    stopTimer();
    inFlight = true;
    try {
      void Promise.resolve(options.send(batch)).then(
        () => {
          settle(batch.length, true);
        },
        () => {
          settle(batch.length, false);
        },
      );
    } catch {
      settle(batch.length, false);
    }
  }

  function beaconBatch(batch: readonly QueuedEvent[]): void {
    try {
      if (options.beacon(batch)) sent += batch.length;
      else droppedEvents.undelivered += batch.length;
    } catch {
      droppedEvents.undelivered += batch.length;
    }
  }

  function flushOnExit(): void {
    stopTimer();
    while (pending.length > 0) beaconBatch(pending.splice(0, batchSize));
  }

  function enqueueRecord(record: EventRecord): void {
    if (closed) return;
    try {
      const scrubbed = scrubbedEvent(record, screenNow());
      addDropped(droppedFields, scrubbed.dropped);
      if (scrubbed.event === undefined) {
        droppedEvents.level += 1;
        return;
      }
      if (pending.length >= maxPending) {
        pending.shift();
        droppedEvents.overflow += 1;
      }
      pending.push(scrubbed.event);
      if (pending.length >= batchSize) flush();
      else startTimer();
    } catch {
      droppedEvents.internal += 1;
    }
  }

  function enqueue<M extends string>(event: CallerEvent<M>): void {
    enqueueRecord(event);
  }

  function close(): void {
    closed = true;
    stopTimer();
  }

  function stats(): QueueStats {
    return { pending: pending.length, sent, droppedEvents: { ...droppedEvents }, droppedFields: { ...droppedFields } };
  }

  return { enqueue, enqueueRecord, flush, flushOnExit, close, stats };
}
