import { logger } from "@qp/telemetry";
import { ProblemError } from "../api/problem-error";

const log = logger("browser");

const CANCELLATION_NAMES = ["AbortError", "CancelledError"];

function isCancellation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  try {
    const name: unknown = Reflect.get(error, "name");
    return typeof name === "string" && CANCELLATION_NAMES.includes(name);
  } catch {
    return false;
  }
}

function isExpected(error: unknown): boolean {
  return (error instanceof ProblemError && error.status < 500) || isCancellation(error);
}

function errorOrNothing(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined;
}

export function reportQueryFailure(error: unknown): void {
  if (!isExpected(error)) log.warn("query failed", {}, errorOrNothing(error));
}

export function reportMutationFailure(error: unknown): void {
  if (!isExpected(error)) log.warn("mutation failed", {}, errorOrNothing(error));
}
