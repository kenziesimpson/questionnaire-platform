import { stackFramesOf } from "../fields.js";
import { scrubContext, type ScrubbedAttributes } from "../scrub.js";
import type { EventQueue } from "./queue.js";
import type { PageEvents, PageListener } from "./page.js";

const ERROR_MESSAGES = { error: "unhandled error", rejection: "unhandled rejection", render: "render error" } as const;

export type ErrorKind = keyof typeof ERROR_MESSAGES;

const FRAME_LOCATION = /^( {4}at (?:.+ \()?)([^\s()]+):(\d+):(\d+)(\)?)$/;

const SCRIPT_FILE = /([A-Za-z0-9_.-]+\.m?js)(?:[?#].*)?$/;

const UNKNOWN_SCRIPT = "anonymous.js";

function frameWithScriptFile(frame: string): string {
  const match = FRAME_LOCATION.exec(frame);
  if (match === null) return frame;
  const [, head = "", location = "", line = "", column = "", tail = ""] = match;
  return `${head}${SCRIPT_FILE.exec(location)?.[1] ?? UNKNOWN_SCRIPT}:${line}:${column}${tail}`;
}

function framesWithScriptFiles(frames: string | undefined): string | undefined {
  return frames?.split("\n").map(frameWithScriptFile).join("\n");
}

function errorAttributes(error: unknown): ScrubbedAttributes {
  if (!(error instanceof Error)) return {};
  return scrubContext({ errorType: error.name, errorStack: framesWithScriptFiles(stackFramesOf(error)) }).attributes;
}

export function captureError(queue: Pick<EventQueue, "enqueue">, kind: ErrorKind, error: unknown): void {
  try {
    queue.enqueue({ level: "error", message: ERROR_MESSAGES[kind], attributes: errorAttributes(error) });
  } catch {
    return;
  }
}

export function installErrorCapture(queue: Pick<EventQueue, "enqueue">, page: PageEvents): () => void {
  const onError: PageListener = (event) => {
    captureError(queue, "error", event.error);
  };
  const onRejection: PageListener = (event) => {
    captureError(queue, "rejection", event.reason);
  };
  page.addEventListener("error", onError);
  page.addEventListener("unhandledrejection", onRejection);
  return () => {
    page.removeEventListener("error", onError);
    page.removeEventListener("unhandledrejection", onRejection);
  };
}
