import {
  problem,
  problemSlug,
  QUESTION_RULE_CODES,
  SUBMISSION_ITEM_CODES,
  type ItemError,
  type PointerError,
  type Problem,
  type ProblemDetailsWire,
  type ProblemSlug,
  type SubmissionItemCode,
} from "@qp/shared";

export const EXECUTION_PROBLEM_SLUGS = [
  "request/invalid",
  "resource/not-found",
  "questionnaire/closed",
  "session/already-submitted",
  "submission/invalid",
  "internal",
] as const satisfies readonly ProblemSlug[];

export type ExecutionProblemSlug = (typeof EXECUTION_PROBLEM_SLUGS)[number];

export type ExecutionProblem<S extends ExecutionProblemSlug = ExecutionProblemSlug> = S extends ExecutionProblemSlug
  ? { readonly slug: S; readonly problem: Problem<S> }
  : never;

const submissionItemCodes: ReadonlySet<string> = new Set(SUBMISSION_ITEM_CODES);
const questionRuleCodes: ReadonlySet<string> = new Set(QUESTION_RULE_CODES);

function isSubmissionItemError(item: { itemId: string; code: string }): item is ItemError<SubmissionItemCode> {
  return submissionItemCodes.has(item.code);
}

function isPointerError(error: { pointer: string; code: string }): error is PointerError {
  return error.code.startsWith("schema/") || questionRuleCodes.has(error.code);
}

function locationOf({ detail, instance }: ProblemDetailsWire): { detail?: string; instance?: string } {
  return { ...(detail === undefined ? {} : { detail }), ...(instance === undefined ? {} : { instance }) };
}

export function executionProblemOf(wire: ProblemDetailsWire): ExecutionProblem | undefined {
  const slug = problemSlug(wire.type);
  const location = locationOf(wire);
  const { errors, items, detail } = wire;
  switch (slug) {
    case "request/invalid":
      return errors?.every(isPointerError) ? { slug, problem: problem(slug, { ...location, errors }) } : undefined;
    case "submission/invalid":
      return items?.every(isSubmissionItemError) ? { slug, problem: problem(slug, { ...location, items }) } : undefined;
    case "internal":
      return detail === undefined ? undefined : { slug, problem: problem(slug, { ...location, detail }) };
    case "resource/not-found":
      return { slug, problem: problem(slug, location) };
    case "questionnaire/closed":
      return { slug, problem: problem(slug, location) };
    case "session/already-submitted":
      return { slug, problem: problem(slug, location) };
    default:
      return undefined;
  }
}
