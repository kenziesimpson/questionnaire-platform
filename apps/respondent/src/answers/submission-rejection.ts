import { visibleItems, type ClientAnswers, type Problem, type PublishedDefinition } from "@qp/shared";
import { errorsByItemId, type ItemErrors } from "@qp/ui/questionnaire";

export interface SubmissionRejection {
  readonly itemErrors: ItemErrors;
  readonly unplacedErrors: boolean;
}

export function submissionRejectionOf(
  definition: PublishedDefinition,
  answers: ClientAnswers,
  body: Problem<"submission/invalid">,
): SubmissionRejection {
  const shownIds = new Set(visibleItems(definition, answers).map((item) => item.itemId));
  const placed = Object.entries(errorsByItemId(body)).filter(([itemId]) => shownIds.has(itemId));
  const itemErrors: ItemErrors = Object.fromEntries(placed);
  const placedCount = placed.reduce((count, [, codes]) => count + (codes?.length ?? 0), 0);
  return { itemErrors, unplacedErrors: placed.length === 0 || placedCount < body.items.length };
}

export function withoutItemError(rejection: SubmissionRejection, itemId: string): SubmissionRejection {
  if (rejection.itemErrors[itemId] === undefined) return rejection;
  const itemErrors: ItemErrors = Object.fromEntries(Object.entries(rejection.itemErrors).filter(([id]) => id !== itemId));
  return { ...rejection, itemErrors };
}
