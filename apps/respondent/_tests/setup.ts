import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class ResizeObserverJsdomLacks {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverJsdomLacks;

function scrollIntoViewJsdomLacks() {}

Element.prototype.scrollIntoView ??= scrollIntoViewJsdomLacks;

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});
