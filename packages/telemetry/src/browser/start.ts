import { installErrorCapture } from "./errors.js";
import { flushOnPageHide } from "./lifecycle.js";
import { routeLogsToQueue, type LoggingRoute } from "./logging.js";
import type { PageWindow } from "./page.js";
import { createEventQueue, type EventQueue, type EventQueueOptions } from "./queue.js";
import { startBrowserTracing, stopBrowserTracing } from "./tracing.js";

export interface BrowserTelemetryOptions extends EventQueueOptions, LoggingRoute {
  readonly page: PageWindow;
}

export interface BrowserTelemetry {
  readonly queue: EventQueue;
  stop(): void;
}

let running: BrowserTelemetry | undefined;

export function startBrowserTelemetry(options: BrowserTelemetryOptions): BrowserTelemetry {
  if (running !== undefined) return running;
  startBrowserTracing();
  const queue = createEventQueue(options);
  const removers = [
    routeLogsToQueue(queue, options),
    flushOnPageHide(queue, options.page),
    installErrorCapture(queue, options.page),
  ];
  const started: BrowserTelemetry = {
    queue,
    stop: () => {
      if (running !== started) return;
      running = undefined;
      for (const remove of removers) remove();
      queue.flushOnExit();
      queue.close();
      void stopBrowserTracing();
    },
  };
  running = started;
  return started;
}
