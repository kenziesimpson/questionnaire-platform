import { problemFromWire, type Problem, type ProblemSlug } from "@qp/shared";

export interface ProblemReply {
  readonly status: number;
  readonly slug: ProblemSlug | undefined;
  readonly problem: Problem | undefined;
}

export function problemReplyOf(status: number, body: unknown): ProblemReply {
  const parsed = problemFromWire(body);
  return { status, slug: parsed?.slug, problem: parsed?.problem };
}

export function problemOf<S extends ProblemSlug>(reply: ProblemReply, slug: S): Problem<S> {
  if (reply.slug !== slug || reply.problem === undefined) {
    throw new Error(`Expected ${slug}, got ${reply.slug ?? "a body outside the problem contract"} with status ${reply.status}`);
  }
  return reply.problem as Problem<S>;
}
