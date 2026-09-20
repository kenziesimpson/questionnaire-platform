import { reportDropped } from "./instruments.js";
import { oneDropped } from "./scrub.js";
import type { SignalKind } from "./vocabulary.js";

export function guardedOr<T>(kind: SignalKind, fallback: T, action: () => T): T {
  try {
    return action();
  } catch {
    reportDropped(kind, oneDropped("internal"));
    return fallback;
  }
}

export function guarded(kind: SignalKind, action: () => void): void {
  guardedOr<void>(kind, undefined, action);
}

export async function guardedAsync(kind: SignalKind, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    reportDropped(kind, oneDropped("internal"));
  }
}
