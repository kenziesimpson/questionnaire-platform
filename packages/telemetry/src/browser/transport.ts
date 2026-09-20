import { telemetryApi } from "@qp/shared";
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

interface BeaconHost {
  sendBeacon(url: string, data: Blob): boolean;
}

function canBeacon(host: unknown): host is BeaconHost {
  return typeof host === "object" && host !== null && typeof Reflect.get(host, "sendBeacon") === "function";
}

export function browserTransport(): Transport {
  return createTransport({
    url: telemetryApi.TELEMETRY_PREFIX,
    fetch: (url, init) =>
      typeof Reflect.get(globalThis, "fetch") === "function" ? globalThis.fetch(url, init) : Promise.reject(new Error(UNDELIVERED)),
    sendBeacon: (url, data) => {
      const host: unknown = Reflect.get(globalThis, "navigator");
      return canBeacon(host) && host.sendBeacon(url, data);
    },
  });
}
