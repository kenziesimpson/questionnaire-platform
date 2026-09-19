import { configureLogging, resetLogging, type LogRecord } from "../logger.js";
import type { EventQueue } from "./queue.js";

export interface LoggingRoute {
  readonly debug?: (record: LogRecord) => void;
}

export function routeLogsToQueue(queue: Pick<EventQueue, "enqueue">, route: LoggingRoute = {}): () => void {
  const { debug } = route;
  configureLogging({
    level: debug === undefined ? "info" : "debug",
    sink: (record) => {
      if (record.level !== "debug") {
        queue.enqueue(record);
        return;
      }
      try {
        debug?.(record);
      } catch {
        return;
      }
    },
  });
  return resetLogging;
}
