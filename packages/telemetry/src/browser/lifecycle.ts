import { guarded } from "../guard.js";
import type { PageListener, PageWindow } from "./page.js";
import type { EventQueue } from "./queue.js";

const HIDDEN = "hidden";

export function flushOnPageHide(queue: Pick<EventQueue, "flushOnExit">, page: PageWindow, beforeExit?: () => void): () => void {
  const exit = (): void => {
    if (beforeExit !== undefined) guarded("log", beforeExit);
    queue.flushOnExit();
  };
  const onPageHide: PageListener = () => {
    exit();
  };
  const onVisibilityChange: PageListener = () => {
    if (page.document.visibilityState === HIDDEN) exit();
  };
  page.addEventListener("pagehide", onPageHide);
  page.document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    page.removeEventListener("pagehide", onPageHide);
    page.document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
