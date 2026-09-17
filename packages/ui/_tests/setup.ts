import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class ResizeObserverJsdomLacks {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function fillJsdomLayoutGaps() {
  globalThis.ResizeObserver ??= ResizeObserverJsdomLacks;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
}

fillJsdomLayoutGaps();

afterEach(cleanup);
