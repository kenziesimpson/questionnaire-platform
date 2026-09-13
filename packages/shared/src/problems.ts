import Type, { type Static } from "typebox";
import { Slug } from "./primitives.js";

/**
 * RFC 9457 problem details ([[7-application-boundary]] §6.1). The slug set is closed: a handler
 * cannot invent one, and the client can switch on it exhaustively. `400` is schema failure only,
 * `409` conflicts with current state, `422` is well-formed but domain-invalid (#20).
 */
export const PROBLEMS = {
  "request/invalid": { status: 400, title: "The request failed validation" },
  "resource/not-found": { status: 404, title: "Resource not found" },
  "questionnaire/draft-invalid": { status: 422, title: "The draft failed publish validation" },
  "questionnaire/draft-stale": { status: 409, title: "The draft has changed since it was read" },
  "questionnaire/draft-exists": { status: 409, title: "A draft is already open" },
  "version/immutable": { status: 409, title: "Published versions cannot be modified" },
  "questionnaire/closed": { status: 409, title: "This questionnaire is no longer accepting responses" },
  "session/already-submitted": { status: 409, title: "This session was already submitted with different answers" },
  "submission/invalid": { status: 422, title: "The submission failed validation" },
  "question/version-conflict": { status: 409, title: "The question was saved concurrently" },
  internal: { status: 500, title: "Internal error" },
} as const satisfies Record<string, { status: number; title: string }>;

export type ProblemSlug = keyof typeof PROBLEMS;
export const PROBLEM_SLUGS = Object.keys(PROBLEMS) as ProblemSlug[];

export const PROBLEM_TYPE_BASE = "https://qp.example/problems/";

/** `version/immutable` → `https://qp.example/problems/version-immutable`, as in §6.1's example. */
export function problemType<S extends ProblemSlug>(slug: S): string {
  return PROBLEM_TYPE_BASE + slug.replace("/", "-");
}

const slugByType = new Map<string, ProblemSlug>(PROBLEM_SLUGS.map((s) => [problemType(s), s]));

/** The client's inverse of `problemType`; `undefined` for anything this contract does not define. */
export function problemSlug(type: string): ProblemSlug | undefined {
  return slugByType.get(type);
}

/**
 * Cross-field rules on a question save that a schema cannot express. They surface as
 * `400 request/invalid`: the editor is expected to make each unrepresentable before a save.
 */
export const QUESTION_RULE_CODES = [
  "question/min-exceeds-max",
  "question/min-length-exceeds-max-length",
  "question/min-selections-exceeds-max-selections",
  "question/selections-exceed-options",
  "question/duplicate-option-id",
  "question/freeform-not-other",
] as const;
export type QuestionRuleCode = (typeof QUESTION_RULE_CODES)[number];

/** Schema failures carry the failing JSON Schema keyword, e.g. `schema/required`. */
export type SchemaErrorCode = `schema/${string}`;
export type RequestErrorCode = QuestionRuleCode | SchemaErrorCode;

/** Per-item publish-validation failures ([[5-questionnaire-format]] §5), for `draft-invalid` and `/draft/validate`. */
export const DRAFT_ITEM_CODES = [
  "draft/duplicate-item-id",
  "draft/duplicate-question",
  "draft/question-archived",
  "draft/question-version-unknown",
  "draft/unreachable",
  "predicate/forward-reference",
  "predicate/unknown-item",
  "predicate/unknown-option",
  "predicate/type-mismatch",
  "predicate/unsatisfiable",
] as const;
export type DraftItemCode = (typeof DRAFT_ITEM_CODES)[number];

/**
 * Per-item submit failures ([[7-application-boundary]] §5.4). A code names the rule, never the value
 * (§5.5); the client already holds the answer and renders the message against it.
 */
export const SUBMISSION_ITEM_CODES = [
  "answer/required",
  "answer/not-visible",
  "answer/unknown-item",
  "answer/type-mismatch",
  "text/too-short",
  "text/too-long",
  "choice/unknown-option",
  "choice/duplicate-option",
  "choice/too-few",
  "choice/too-many",
  "choice/other-text-without-other",
  "choice/other-text-required",
  "number/not-integer",
  "number/out-of-range",
  "date/out-of-range",
  "date/in-future",
  "date/in-past",
] as const;
export type SubmissionItemCode = (typeof SUBMISSION_ITEM_CODES)[number];

export interface PointerError {
  /** RFC 6901 JSON Pointer into the request, e.g. `/body/question/max`. */
  pointer: string;
  code: RequestErrorCode;
}

export interface ItemError<C extends string> {
  itemId: string;
  code: C;
}

/** Extension members each slug carries. A slug absent here carries none. */
interface ProblemExtensions {
  "request/invalid": { errors: PointerError[] };
  "questionnaire/draft-invalid": { items: ItemError<DraftItemCode>[] };
  "submission/invalid": { items: ItemError<SubmissionItemCode>[] };
  /** `detail` is the correlation id, equal to the trace id — never a message or a stack (§6.2). */
  internal: { detail: string };
}

type ExtensionFor<S extends ProblemSlug> = S extends keyof ProblemExtensions ? ProblemExtensions[S] : {};

export type Problem<S extends ProblemSlug = ProblemSlug> = S extends ProblemSlug
  ? {
      type: string;
      title: string;
      status: (typeof PROBLEMS)[S]["status"];
      detail?: string;
      instance?: string;
    } & ExtensionFor<S>
  : never;

export type ProblemInit<S extends ProblemSlug> = { detail?: string; instance?: string } & ExtensionFor<S>;

/**
 * The only way to build a problem body. `detail` must not contain a submitted answer — the redaction
 * rule applies to error bodies as much as to telemetry ([[7-application-boundary]] §5.5).
 */
export function problem<S extends ProblemSlug>(slug: S, ...init: {} extends ProblemInit<S> ? [ProblemInit<S>?] : [ProblemInit<S>]): Problem<S> {
  const { status, title } = PROBLEMS[slug];
  return { type: problemType(slug), title, status, ...(init[0] ?? {}) } as Problem<S>;
}

const strict = { additionalProperties: false } as const;

/** The wire schema, for `4xx` / `5xx` responses on every route. */
export const ProblemDetails = Type.Object(
  {
    type: Type.Union(PROBLEM_SLUGS.map((s) => Type.Literal(problemType(s)))),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.Optional(Type.String()),
    instance: Type.Optional(Type.String()),
    errors: Type.Optional(Type.Array(Type.Object({ pointer: Type.String(), code: Type.String() }, strict))),
    items: Type.Optional(
      Type.Array(
        Type.Object(
          { itemId: Slug, code: Type.Union([...DRAFT_ITEM_CODES, ...SUBMISSION_ITEM_CODES].map((c) => Type.Literal(c))) },
          strict,
        ),
      ),
    ),
  },
  strict,
);
export type ProblemDetailsWire = Static<typeof ProblemDetails>;

export const PROBLEM_CONTENT_TYPE = "application/problem+json";
