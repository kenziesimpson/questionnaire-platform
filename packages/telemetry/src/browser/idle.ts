import { guarded } from "../guard.js";
import type { PageWindow } from "./page.js";

const IDLE_TIMEOUT_MS = 2000;

const LOAD_FALLBACK_DELAY_MS = 2000;

const COMPLETE = "complete";

export function afterFirstPaint(start: () => void, page: PageWindow): () => void {
  let finished = false;
  let cancelPending: () => void = () => undefined;

  const run = (): void => {
    if (finished) return;
    finished = true;
    guarded("log", start);
  };

  const schedule = (): void => {
    if (finished) return;
    if (page.requestIdleCallback !== undefined) {
      const idleHandle = page.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      cancelPending = () => {
        page.cancelIdleCallback?.(idleHandle);
      };
      return;
    }
    const timeoutHandle = setTimeout(run, LOAD_FALLBACK_DELAY_MS);
    cancelPending = () => {
      clearTimeout(timeoutHandle);
    };
  };

  const onLoad = (): void => {
    page.removeEventListener("load", onLoad);
    schedule();
  };

  if (page.document.readyState === COMPLETE) {
    schedule();
  } else {
    page.addEventListener("load", onLoad);
    cancelPending = () => {
      page.removeEventListener("load", onLoad);
    };
  }

  return () => {
    finished = true;
    cancelPending();
  };
}
