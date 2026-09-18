import { problem, respondentDateContext, validateSubmission, visibleAnswers, type ClientAnswers, type PublishedDefinition } from "@qp/shared";
import { errorsByItemId, type ItemErrors } from "@qp/ui/questionnaire";

export interface PrecheckFailure {
  readonly itemErrors: ItemErrors;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function precheckAnswers(
  definition: PublishedDefinition,
  answers: ClientAnswers,
  now: Date = new Date(),
  timeZone: string = browserTimeZone(),
): PrecheckFailure | undefined {
  const validation = validateSubmission(definition, visibleAnswers(definition, answers), respondentDateContext(now, timeZone));
  if (validation.valid) return undefined;
  const itemErrors = errorsByItemId(problem("submission/invalid", { items: validation.items }));
  return Object.keys(itemErrors).length === 0 ? undefined : { itemErrors };
}
