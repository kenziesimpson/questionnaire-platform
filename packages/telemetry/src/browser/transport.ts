import type { QueuedEvent } from "./events.js";
import type { EventQueueOptions } from "./queue.js";
import { BEACON_BODY_BUDGET_BYTES, toBeaconBlob, toEnvelopes, toFetchInit, type FetchInit } from "./wire.js";

export interface TransportOptions {
  readonly url: string;
  readonly fetch: (url: string, init: FetchInit) => Promise<{ readonly ok: boolean }>;
  readonly sendBeacon: (url: string, data: Blob) => boolean;
}

export type Transport = Pick<EventQueueOptions, "send" | "beacon">;

const UNDELIVERED = "undelivered";

export function createTransport({ url, fetch, sendBeacon }: TransportOptions): Transport {
  return {
    send: async (events: readonly QueuedEvent[]) => {
      for (const envelope of toEnvelopes(events)) {
        const response = await fetch(url, toFetchInit(envelope));
        if (!response.ok) throw new Error(UNDELIVERED);
      }
    },
    beacon: (events: readonly QueuedEvent[]) => {
      const accepted = toEnvelopes(events, BEACON_BODY_BUDGET_BYTES).map((envelope) => sendBeacon(url, toBeaconBlob(envelope)));
      return accepted.every(Boolean);
    },
  };
}
