import { installErrorCapture } from "./errors.js";
import { flushOnPageHide } from "./lifecycle.js";
import { routeLogsToQueue, type LoggingRoute } from "./logging.js";
import type { PageWindow } from "./page.js";
import { createEventQueue, type EventQueue, type EventQueueOptions } from "./queue.js";

export interface BrowserTelemetryOptions extends EventQueueOptions, LoggingRoute {
  readonly page: PageWindow;
  readonly beforeExit?: () => void;
}

export interface BrowserTelemetry {
  readonly queue: EventQueue;
  stop(): void;
}

let running: BrowserTelemetry | undefined;

export function startBrowserTelemetry(options: BrowserTelemetryOptions): BrowserTelemetry {
  if (running !== undefined) return running;
  const queue = createEventQueue(options);
  const removers = [
    routeLogsToQueue(queue, options),
    flushOnPageHide(queue, options.page, options.beforeExit),
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
    },
  };
  running = started;
  return started;
}
