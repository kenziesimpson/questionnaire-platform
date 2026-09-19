import type { PageDocument, PageEvent, PageEvents, PageListener, PageWindow } from "../../src/browser/page.js";

export class FakeEvents implements PageEvents {
  private readonly listeners = new Map<string, Set<PageListener>>();

  addEventListener(type: string, listener: PageListener): void {
    const forType = this.listeners.get(type) ?? new Set<PageListener>();
    forType.add(listener);
    this.listeners.set(type, forType);
  }

  removeEventListener(type: string, listener: PageListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatch(type: string, extra: object = {}): void {
    const event: PageEvent = { type, ...extra };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

export class FakeDocument extends FakeEvents implements PageDocument {
  readyState = "complete";
  visibilityState = "visible";
}

export class FakeWindow extends FakeEvents implements PageWindow {
  readonly document = new FakeDocument();
  requestIdleCallback?: PageWindow["requestIdleCallback"];
  cancelIdleCallback?: PageWindow["cancelIdleCallback"];
}
