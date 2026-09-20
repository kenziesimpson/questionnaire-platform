import { createEventQueue, routeLogsToQueue, type QueuedEvent, type Transport } from "@qp/telemetry/browser";
import { vi } from "vitest";
import { startAdminTelemetry, type AdminTelemetry } from "../../src/telemetry/start";

export function recordingTransport() {
  const sent: QueuedEvent[] = [];
  const beaconed: QueuedEvent[] = [];
  const transport: Transport = {
    send: (events) => {
      sent.push(...events);
    },
    beacon: (events) => {
      beaconed.push(...events);
      return true;
    },
  };
  return { transport, sent, beaconed };
}

export function startedTelemetry(options: { readonly screen: () => string | undefined; readonly transport?: Transport }): AdminTelemetry {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const telemetry = startAdminTelemetry({ page: window, ...options });
  window.dispatchEvent(new Event("load"));
  vi.advanceTimersByTime(2000);
  vi.useRealTimers();
  return telemetry;
}

export function routedQueue() {
  const sent: QueuedEvent[] = [];
  const queue = createEventQueue({
    send: (events) => {
      sent.push(...events);
    },
    beacon: () => true,
  });
  const stopRouting = routeLogsToQueue(queue);
  return {
    flush: () => {
      queue.flush();
      return sent;
    },
    stop: () => {
      stopRouting();
      queue.close();
    },
  };
}
