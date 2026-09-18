import type { ProblemSlug, WireProblem } from "@qp/shared";

export const EXECUTION_PROBLEM_SLUGS = [
  "request/invalid",
  "resource/not-found",
  "questionnaire/closed",
  "session/already-submitted",
  "submission/invalid",
  "internal",
] as const satisfies readonly ProblemSlug[];

export type ExecutionProblemSlug = (typeof EXECUTION_PROBLEM_SLUGS)[number];

export type ExecutionProblem<S extends ExecutionProblemSlug = ExecutionProblemSlug> = Extract<WireProblem, { slug: S }>;
