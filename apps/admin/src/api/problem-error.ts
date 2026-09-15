import {
  DRAFT_ITEM_CODES,
  ProblemDetails,
  QUESTION_RULE_CODES,
  SUBMISSION_ITEM_CODES,
  problem,
  problemSlug,
  type DraftItemCode,
  type ItemError,
  type PointerError,
  type Problem,
  type ProblemDetailsWire,
  type ProblemSlug,
  type RequestErrorCode,
  type SubmissionItemCode,
} from "@qp/shared";
import { Value } from "typebox/value";

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

function isRequestErrorCode(code: string): code is RequestErrorCode {
  return code.startsWith("schema/") || QUESTION_RULE_CODES.some((rule) => rule === code);
}

function isDraftItemCode(code: string): code is DraftItemCode {
  return DRAFT_ITEM_CODES.some((known) => known === code);
}

function isSubmissionItemCode(code: string): code is SubmissionItemCode {
  return SUBMISSION_ITEM_CODES.some((known) => known === code);
}

function pointerErrorsOf(wire: ProblemDetailsWire): PointerError[] {
  return (wire.errors ?? []).flatMap(({ pointer, code }) => (isRequestErrorCode(code) ? [{ pointer, code }] : []));
}

function itemErrorsOf<C extends string>(wire: ProblemDetailsWire, isCode: (code: string) => code is C): ItemError<C>[] {
  return (wire.items ?? []).flatMap(({ itemId, code }) => (isCode(code) ? [{ itemId, code }] : []));
}

type ProblemBuilders = { [S in ProblemSlug]: (wire: ProblemDetailsWire) => Problem<S> };

const baseOf = ({ detail, instance }: ProblemDetailsWire) => ({ detail, instance });

const problemBuilders: ProblemBuilders = {
  "request/invalid": (wire) => problem("request/invalid", { ...baseOf(wire), errors: pointerErrorsOf(wire) }),
  "resource/not-found": (wire) => problem("resource/not-found", baseOf(wire)),
  "questionnaire/draft-invalid": (wire) =>
    problem("questionnaire/draft-invalid", { ...baseOf(wire), items: itemErrorsOf(wire, isDraftItemCode) }),
  "questionnaire/draft-stale": (wire) => problem("questionnaire/draft-stale", baseOf(wire)),
  "questionnaire/draft-exists": (wire) => problem("questionnaire/draft-exists", baseOf(wire)),
  "version/immutable": (wire) => problem("version/immutable", baseOf(wire)),
  "questionnaire/closed": (wire) => problem("questionnaire/closed", baseOf(wire)),
  "session/already-submitted": (wire) => problem("session/already-submitted", baseOf(wire)),
  "submission/invalid": (wire) =>
    problem("submission/invalid", { ...baseOf(wire), items: itemErrorsOf(wire, isSubmissionItemCode) }),
  "question/version-conflict": (wire) => problem("question/version-conflict", baseOf(wire)),
  internal: (wire) => problem("internal", { instance: wire.instance, detail: wire.detail ?? "" }),
};

function buildProblemError<S extends ProblemSlug>(slug: S, status: number, wire: ProblemDetailsWire): ProblemError<S> {
  const build: (wire: ProblemDetailsWire) => Problem<S> = problemBuilders[slug];
  return new ProblemError(slug, status, build(wire));
}

export function problemErrorFrom(status: number, body: unknown): ProblemError | undefined {
  if (!Value.Check(ProblemDetails, body)) return undefined;
  const slug = problemSlug(body.type);
  return slug === undefined ? undefined : buildProblemError(slug, status, body);
}
