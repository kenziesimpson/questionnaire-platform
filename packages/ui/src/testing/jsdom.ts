class ResizeObserverJsdomLacks {
  observe() {}
  unobserve() {}
  disconnect() {}
}

export function fillJsdomLayoutGaps() {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the DOM lib types declare this as always present; jsdom does not provide it, which is what this polyfill fills in
  globalThis.ResizeObserver ??= ResizeObserverJsdomLacks;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the DOM lib types declare this as always present; jsdom does not provide it, which is what this polyfill fills in
  Element.prototype.scrollIntoView ??= () => undefined;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the DOM lib types declare this as always present; jsdom does not provide it, which is what this polyfill fills in
  Element.prototype.hasPointerCapture ??= () => false;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the DOM lib types declare this as always present; jsdom does not provide it, which is what this polyfill fills in
  Element.prototype.releasePointerCapture ??= () => undefined;
}
