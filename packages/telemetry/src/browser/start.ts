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

export function startBrowserTelemetry(options: BrowserTelemetryOptions): BrowserTelemetry {
  startBrowserTracing();
  const queue = createEventQueue(options);
  const removers = [
    routeLogsToQueue(queue, options),
    flushOnPageHide(queue, options.page),
    installErrorCapture(queue, options.page),
  ];
  return {
    queue,
    stop: () => {
      for (const remove of removers) remove();
      queue.flush();
      void stopBrowserTracing();
    },
  };
}
