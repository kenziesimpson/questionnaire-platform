import type { PageListener, PageWindow } from "./page.js";
import type { EventQueue } from "./queue.js";

const HIDDEN = "hidden";

export function flushOnPageHide(queue: Pick<EventQueue, "flushOnExit">, page: PageWindow): () => void {
  const onPageHide: PageListener = () => {
    queue.flushOnExit();
  };
  const onVisibilityChange: PageListener = () => {
    if (page.document.visibilityState === HIDDEN) queue.flushOnExit();
  };
  page.addEventListener("pagehide", onPageHide);
  page.document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    page.removeEventListener("pagehide", onPageHide);
    page.document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
