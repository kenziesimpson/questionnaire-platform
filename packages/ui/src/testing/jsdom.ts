class ResizeObserverJsdomLacks {
  observe() {}
  unobserve() {}
  disconnect() {}
}

export function fillJsdomLayoutGaps() {
  globalThis.ResizeObserver ??= ResizeObserverJsdomLacks;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
}
