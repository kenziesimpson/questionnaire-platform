import { logger } from "@qp/telemetry";
import { ProblemError } from "../api/problem-error";

const log = logger("browser");

const CANCELLATION_NAMES = ["AbortError", "CancelledError"];

function isExpected(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error instanceof ProblemError && error.status < 500) || CANCELLATION_NAMES.includes(error.name);
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
