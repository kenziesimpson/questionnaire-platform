import Type, { type Static } from "typebox";
import { Value } from "typebox/value";
import { Slug, strict } from "./primitives.js";

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
  "service/unavailable": { status: 503, title: "The service is not ready to accept requests" },
} as const satisfies Record<string, { status: number; title: string }>;

export type ProblemSlug = keyof typeof PROBLEMS;
export const PROBLEM_SLUGS = Object.keys(PROBLEMS) as ProblemSlug[];

export const PROBLEM_TYPE_BASE = "https://qp.example/problems/";

export type ProblemType<S extends ProblemSlug = ProblemSlug> =
  `${typeof PROBLEM_TYPE_BASE}${S extends `${infer Area}/${infer Name}` ? `${Area}-${Name}` : S}`;

export function problemType<S extends ProblemSlug>(slug: S): ProblemType<S> {
  return (PROBLEM_TYPE_BASE + slug.replace("/", "-")) as ProblemType<S>;
}

const slugByType = new Map<string, ProblemSlug>(PROBLEM_SLUGS.map((s) => [problemType(s), s]));

export function problemSlug(type: string): ProblemSlug | undefined {
  return slugByType.get(type);
}

export const QUESTION_RULE_CODES = [
  "question/min-exceeds-max",
  "question/min-length-exceeds-max-length",
  "question/min-selections-exceeds-max-selections",
  "question/selections-exceed-options",
  "question/duplicate-option-id",
  "question/freeform-not-other",
  "question/other-not-freeform",
  "question/type-changed",
] as const;
export type QuestionRuleCode = (typeof QUESTION_RULE_CODES)[number];

export type SchemaErrorCode = `schema/${string}`;
export type RequestErrorCode = QuestionRuleCode | SchemaErrorCode;

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
  pointer: string;
  code: RequestErrorCode;
}

export interface ItemError<C extends string> {
  itemId: string;
  code: C;
}

export function isQuestionRuleCode(code: string): code is QuestionRuleCode {
  return QUESTION_RULE_CODES.some((rule) => rule === code);
}

export function isRequestErrorCode(code: string): code is RequestErrorCode {
  return code.startsWith("schema/") || isQuestionRuleCode(code);
}

export function isDraftItemCode(code: string): code is DraftItemCode {
  return DRAFT_ITEM_CODES.some((known) => known === code);
}

export function isSubmissionItemCode(code: string): code is SubmissionItemCode {
  return SUBMISSION_ITEM_CODES.some((known) => known === code);
}

interface ProblemExtensions {
  "request/invalid": { errors: PointerError[] };
  "questionnaire/draft-invalid": { items: ItemError<DraftItemCode>[] };
  "submission/invalid": { items: ItemError<SubmissionItemCode>[] };
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

function problemBody<S extends ProblemSlug>(slug: S, members: object): Problem<S> {
  const { status, title } = PROBLEMS[slug];
  return { type: problemType(slug), title, status, ...members } as Problem<S>;
}

export function problem<S extends ProblemSlug>(slug: S, ...init: {} extends ProblemInit<S> ? [ProblemInit<S>?] : [ProblemInit<S>]): Problem<S> {
  return problemBody(slug, init[0] ?? {});
}

export function ItemErrorOf<Codes extends string[]>(codes: readonly [...Codes]) {
  return Type.Object({ itemId: Slug, code: Type.Enum(codes) }, strict);
}

const PointerErrorWire = Type.Object({ pointer: Type.String(), code: Type.String() }, strict);

export const ProblemDetails = Type.Object(
  {
    type: Type.Enum(PROBLEM_SLUGS.map(problemType)),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.Optional(Type.String()),
    instance: Type.Optional(Type.String()),
    errors: Type.Optional(Type.Array(PointerErrorWire)),
    items: Type.Optional(Type.Array(ItemErrorOf([...DRAFT_ITEM_CODES, ...SUBMISSION_ITEM_CODES]))),
  },
  strict,
);
export type ProblemDetailsWire = Static<typeof ProblemDetails>;

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

const ProblemEnvelope = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.Optional(Type.String()),
    instance: Type.Optional(Type.String()),
    errors: Type.Optional(Type.Array(PointerErrorWire)),
    items: Type.Optional(Type.Array(Type.Object({ itemId: Slug, code: Type.String() }, strict))),
  },
  strict,
);
type ProblemEnvelopeWire = Static<typeof ProblemEnvelope>;

export type WireProblem<S extends ProblemSlug = ProblemSlug> = S extends ProblemSlug
  ? { readonly slug: S; readonly problem: Problem<S> }
  : never;

export const PROBLEM_EXTENSION_MEMBERS = {
  "request/invalid": ["errors"],
  "questionnaire/draft-invalid": ["items"],
  "submission/invalid": ["items"],
  internal: ["detail"],
} as const satisfies { [S in keyof ProblemExtensions]: readonly (keyof ProblemExtensions[S])[] };

type ExtensionReaders = {
  [S in keyof ProblemExtensions]: (wire: ProblemEnvelopeWire) => ProblemExtensions[S] | undefined;
};

function allKnown<Wire, Known extends Wire>(
  declared: readonly Wire[] | undefined,
  isKnown: (candidate: Wire) => candidate is Known,
): Known[] | undefined {
  if (declared === undefined) return undefined;
  const known = declared.filter(isKnown);
  return known.length === declared.length ? known : undefined;
}

function itemsOf<C extends string>(isCode: (code: string) => code is C) {
  const isItemError = (item: { itemId: string; code: string }): item is ItemError<C> => isCode(item.code);
  return (wire: ProblemEnvelopeWire) => {
    const items = allKnown(wire.items, isItemError);
    return items === undefined ? undefined : { items };
  };
}

const isPointerError = (error: { pointer: string; code: string }): error is PointerError => isRequestErrorCode(error.code);

const PROBLEM_EXTENSIONS: ExtensionReaders = {
  "request/invalid": (wire) => {
    const errors = allKnown(wire.errors, isPointerError);
    return errors === undefined ? undefined : { errors };
  },
  "questionnaire/draft-invalid": itemsOf(isDraftItemCode),
  "submission/invalid": itemsOf(isSubmissionItemCode),
  internal: ({ detail }) => (detail === undefined ? undefined : { detail }),
};

function carriesExtensions(slug: ProblemSlug): slug is keyof ProblemExtensions {
  return slug in PROBLEM_EXTENSIONS;
}

function locationOf({ detail, instance }: ProblemEnvelopeWire): { detail?: string; instance?: string } {
  return { ...(detail === undefined ? {} : { detail }), ...(instance === undefined ? {} : { instance }) };
}

export function problemFromWire(wire: unknown): WireProblem | undefined {
  if (!Value.Check(ProblemEnvelope, wire)) return undefined;
  const slug = problemSlug(wire.type);
  if (slug === undefined) return undefined;
  const extensions = carriesExtensions(slug) ? PROBLEM_EXTENSIONS[slug](wire) : {};
  if (extensions === undefined) return undefined;
  return { slug, problem: problemBody(slug, { ...locationOf(wire), ...extensions }) } as WireProblem;
}
