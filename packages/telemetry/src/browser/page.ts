export interface PageEvent {
  readonly type: string;
  readonly error?: unknown;
  readonly reason?: unknown;
}

export type PageListener = (event: PageEvent) => void;

export interface PageEvents {
  addEventListener(type: string, listener: PageListener): void;
  removeEventListener(type: string, listener: PageListener): void;
}

export interface PageDocument extends PageEvents {
  readonly readyState: string;
  readonly visibilityState: string;
}

export interface PageWindow extends PageEvents {
  readonly document: PageDocument;
  requestIdleCallback?(callback: () => void, options?: { readonly timeout: number }): number;
  cancelIdleCallback?(handle: number): void;
}
