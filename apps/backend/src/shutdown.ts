import { logger } from "@qp/telemetry";

const log = logger("backend");

export const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 5_000;

export interface ShutdownParts {
  readonly closeApp: () => Promise<void>;
  readonly telemetry: { readonly flush: () => Promise<void>; readonly shutdown: () => Promise<void> };
  readonly closePools: () => Promise<void>;
  readonly telemetryTimeoutMs?: number;
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

function withinTimeout(step: () => Promise<void>, timeoutMs: number): () => Promise<void> {
  return async () => {
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("telemetry shutdown timed out")), timeoutMs);
    });
    try {
      await Promise.race([step(), expired]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function shutDown(parts: ShutdownParts): Promise<boolean> {
  const appClosed = await attempt(parts.closeApp, (error) => {
    log.error("closing the server failed", undefined, error);
  });
  const telemetryClosed = await attempt(
    withinTimeout(async () => {
      await parts.telemetry.flush();
      await parts.telemetry.shutdown();
    }, parts.telemetryTimeoutMs ?? TELEMETRY_SHUTDOWN_TIMEOUT_MS),
    (error) => {
      log.error("telemetry did not shut down cleanly", undefined, error);
    },
  );
  const poolsClosed = await attempt(parts.closePools, () => undefined);
  return appClosed && telemetryClosed && poolsClosed;
}
