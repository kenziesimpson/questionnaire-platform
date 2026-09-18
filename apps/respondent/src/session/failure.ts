import type { ClientAnswers } from "@qp/shared";
import type { FailureReason } from "./respondent-state.ts";

export function isRetryable(reason: FailureReason): boolean {
  return reason.kind !== "problem" || reason.slug === "internal";
}

export function hasAnyAnswer(answers: ClientAnswers): boolean {
  return Object.values(answers).some((answer) => answer !== null);
}
