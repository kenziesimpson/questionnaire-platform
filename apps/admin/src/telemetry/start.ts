import { afterFirstPaint, captureError, startBrowserTelemetry, type BrowserTelemetry, type PageWindow, type Transport } from "@qp/telemetry/browser";
import { browserTransport } from "../api/telemetry-transport";

interface AdminTelemetryOptions {
  readonly page: PageWindow;
  readonly screen: () => string | undefined;
  readonly transport?: Transport;
}

export interface AdminTelemetry {
  stop(): void;
  running(): BrowserTelemetry | undefined;
}

let current: BrowserTelemetry | undefined;

export function reportRenderError(error: unknown): void {
  if (current !== undefined) captureError(current.queue, "render", error);
}

export function startAdminTelemetry({ page, screen, transport = browserTransport() }: AdminTelemetryOptions): AdminTelemetry {
  let started: BrowserTelemetry | undefined;
  const cancel = afterFirstPaint(() => {
    started = startBrowserTelemetry({ ...transport, page, screen });
    current = started;
  }, page);
  return {
    stop: () => {
      cancel();
      started?.stop();
      if (current === started) current = undefined;
    },
    running: () => started,
  };
}
