import { logger } from "@qp/telemetry";
import { ProblemError } from "../api/problem-error";

const log = logger("browser");

const CANCELLATION_NAMES = ["AbortError", "CancelledError"];

function isExpected(error: Error): boolean {
  return (error instanceof ProblemError && error.status < 500) || CANCELLATION_NAMES.includes(error.name);
}

export function reportQueryFailure(error: Error): void {
  if (!isExpected(error)) log.warn("query failed", {}, error);
}

export function reportMutationFailure(error: Error): void {
  if (!isExpected(error)) log.warn("mutation failed", {}, error);
}
