export { captureError, installErrorCapture, type ErrorKind } from "./browser/errors.js";
export { QUEUED_LEVELS, type EventInput, type QueuedEvent, type QueuedLevel } from "./browser/events.js";
export { afterFirstPaint } from "./browser/idle.js";
export { flushOnPageHide } from "./browser/lifecycle.js";
export { routeLogsToQueue, type LoggingRoute } from "./browser/logging.js";
export type { PageDocument, PageEvent, PageEvents, PageListener, PageWindow } from "./browser/page.js";
export { createEventQueue, type EventDropReason, type EventQueue, type EventQueueOptions, type QueueStats } from "./browser/queue.js";
export { startBrowserTelemetry, type BrowserTelemetry, type BrowserTelemetryOptions } from "./browser/start.js";
export { injectTraceHeaders, startBrowserTracing, stopBrowserTracing } from "./browser/tracing.js";
