import { configureLogging, currentLogging, type LogRecord } from "../logger.js";
import type { EventQueue } from "./queue.js";

export interface LoggingRoute {
  readonly debug?: (record: LogRecord) => void;
}

export function routeLogsToQueue(queue: Pick<EventQueue, "enqueueRecord">, route: LoggingRoute = {}): () => void {
  const { debug } = route;
  const previous = currentLogging();
  const sink = (record: LogRecord): void => {
    if (record.level !== "debug") {
      queue.enqueueRecord(record);
      return;
    }
    try {
      debug?.(record);
    } catch {
      return;
    }
  };
  configureLogging({ level: debug === undefined ? "info" : "debug", sink });
  return () => {
    if (currentLogging().sink === sink) configureLogging(previous);
  };
}
