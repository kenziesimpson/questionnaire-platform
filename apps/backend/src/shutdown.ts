import { logger } from "@qp/telemetry";
import { withTimeout } from "./timeout.js";

const log = logger("backend");

export const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 5_000;

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

export interface ShutdownParts {
  readonly closeApp: () => Promise<void>;
  readonly telemetry: { readonly flush: () => Promise<void>; readonly shutdown: () => Promise<void> };
  readonly closePools: () => Promise<void>;
  readonly telemetryTimeoutMs?: number;
}

export interface SignalSource {
  on(signal: (typeof SIGNALS)[number], listener: () => void): unknown;
  exit(code: number): unknown;
}

async function attempt(step: () => Promise<void>, reportFailure: (error: Error | undefined) => void): Promise<boolean> {
  try {
    await step();
    return true;
  } catch (error) {
    reportFailure(error instanceof Error ? error : undefined);
    return false;
  }
}

export async function shutDown(parts: ShutdownParts): Promise<boolean> {
  const timeoutMs = parts.telemetryTimeoutMs ?? TELEMETRY_SHUTDOWN_TIMEOUT_MS;
  const appClosed = await attempt(parts.closeApp, (error) => {
    log.error("closing the server failed", undefined, error);
  });
  const flushed = await attempt(
    () => withTimeout(parts.telemetry.flush(), timeoutMs),
    (error) => {
      log.error("flushing telemetry failed", undefined, error);
    },
  );
  const poolsClosed = await attempt(parts.closePools, (error) => {
    log.error("closing the database pools failed", undefined, error);
  });
  const telemetryClosed = await attempt(
    () => withTimeout(parts.telemetry.shutdown(), timeoutMs),
    (error) => {
      log.error("shutting down telemetry failed", undefined, error);
    },
  );
  return appClosed && flushed && poolsClosed && telemetryClosed;
}

export function shutDownOnSignals(parts: ShutdownParts, source: SignalSource): void {
  let shuttingDown = false;
  for (const signal of SIGNALS) {
    source.on(signal, async () => {
      if (shuttingDown) {
        source.exit(1);
        return;
      }
      shuttingDown = true;
      log.info("shutting down", { signal });
      source.exit((await shutDown(parts)) ? 0 : 1);
    });
  }
}
