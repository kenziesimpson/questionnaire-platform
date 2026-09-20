export { captureError, installErrorCapture, type ErrorKind } from "./browser/errors.js";
export { type CallerAttributes, type CallerEvent, type EventRecord, type QueuedEvent } from "./browser/events.js";
export { afterFirstPaint } from "./browser/idle.js";
export { flushOnPageHide } from "./browser/lifecycle.js";
export { routeLogsToQueue, type LoggingRoute } from "./browser/logging.js";
export type { PageDocument, PageEvent, PageEvents, PageListener, PageWindow } from "./browser/page.js";
export { createEventQueue, type EventDropReason, type EventQueue, type EventQueueOptions, type QueueStats } from "./browser/queue.js";
export { startBrowserTelemetry, type BrowserTelemetry, type BrowserTelemetryOptions } from "./browser/start.js";
export { injectTraceHeaders, startBrowserTracing, stopBrowserTracing } from "./browser/tracing.js";
export {
  BEACON_BODY_BUDGET_BYTES,
  toBeaconBlob,
  toEnvelopes,
  toFetchInit,
  toWireEvent,
  type FetchInit,
  type WireEnvelope,
  type WireEvent,
} from "./browser/wire.js";
export type { LogRecord } from "./logger.js";
export { CLIENT_LOG_LEVELS, type ClientLogLevel } from "./vocabulary.js";
