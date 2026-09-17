import { problemFromWire, type Problem, type ProblemSlug } from "@qp/shared";

export class ProblemError<S extends ProblemSlug = ProblemSlug> extends Error {
  readonly slug: S;
  readonly status: number;
  readonly problem: Problem<S>;

  constructor(slug: S, status: number, body: Problem<S>) {
    super(`${status} ${slug}: ${body.title}`);
    this.name = "ProblemError";
    this.slug = slug;
    this.status = status;
    this.problem = body;
  }
}

export class UnexpectedResponseError extends Error {
  readonly status: number;

  constructor(status: number, reason: string) {
    super(`${status}: ${reason}`);
    this.name = "UnexpectedResponseError";
    this.status = status;
  }
}

export function isProblem<S extends ProblemSlug>(error: unknown, slug: S): error is ProblemError<S> {
  return error instanceof ProblemError && error.slug === slug;
}

export function problemErrorFrom(status: number, body: unknown): ProblemError | undefined {
  const parsed = problemFromWire(body, { unknownCodes: "drop" });
  return parsed === undefined ? undefined : new ProblemError(parsed.slug, status, parsed.problem);
}
