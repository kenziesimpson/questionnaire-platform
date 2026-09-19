import { stackFramesOf } from "../fields.js";
import { scrubContext, type ScrubbedAttributes } from "../scrub.js";
import type { PageEvents, PageListener } from "./page.js";
import type { EventQueue } from "./queue.js";

const ERROR_MESSAGES = { error: "unhandled error", rejection: "unhandled rejection", render: "render error" } as const;

export type ErrorKind = keyof typeof ERROR_MESSAGES;

type ErrorSink = Pick<EventQueue, "enqueueRecord">;

const installed = new Map<PageEvents, () => void>();

function errorAttributes(error: unknown): ScrubbedAttributes {
  if (!(error instanceof Error)) return {};
  return scrubContext({ errorType: error.name, errorStack: stackFramesOf(error) }).attributes;
}

export function captureError(queue: ErrorSink, kind: ErrorKind, error: unknown): void {
  try {
    queue.enqueueRecord({ level: "error", message: ERROR_MESSAGES[kind], attributes: errorAttributes(error) });
  } catch {
    return;
  }
}

export function installErrorCapture(queue: ErrorSink, page: PageEvents): () => void {
  const existing = installed.get(page);
  if (existing !== undefined) return existing;
  const onError: PageListener = (event) => {
    captureError(queue, "error", event.error);
  };
  const onRejection: PageListener = (event) => {
    captureError(queue, "rejection", event.reason);
  };
  page.addEventListener("error", onError);
  page.addEventListener("unhandledrejection", onRejection);
  const uninstall = (): void => {
    page.removeEventListener("error", onError);
    page.removeEventListener("unhandledrejection", onRejection);
    installed.delete(page);
  };
  installed.set(page, uninstall);
  return uninstall;
}
