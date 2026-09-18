import Type, { type Static, type TProperties } from "typebox";
import { IsoDate, IsoDateTime, NonNegativeInt, PositiveInt, Slug, Uuid, strict } from "../primitives.js";

/**
 * Five response types. There is no `yes_no`: a yes/no question is a `single_choice` created by an
 * editor template with option ids `yes` / `no` (Decisions Log #36).
 */
export const RESPONSE_TYPES = ["text", "single_choice", "multiple_choice", "number", "date"] as const;
export const ResponseType = Type.Enum(RESPONSE_TYPES);
export type ResponseType = (typeof RESPONSE_TYPES)[number];

/** Option ids are stable across question versions; rules and responses key on them, never on labels. */
export const Option = Type.Object(
  {
    optionId: Slug,
    label: Type.String({ minLength: 1 }),
    /** Only the option with id `other` may be freeform; checked when a question is saved. */
    freeform: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type Option = Static<typeof Option>;

const Options = Type.Array(Option, { minItems: 1 });
const Prompt = Type.String({ minLength: 1 });

/**
 * One object per response type, with that type's constraints flat on it — the shape in
 * [[5-questionnaire-format]] §3. `head` carries the identity fields that differ between the
 * snapshot, the bank and a save request, so the per-type constraints are written once.
 */
function questionUnion<H extends TProperties>(head: H) {
  return Type.Union([
    Type.Object(
      {
        ...head,
        type: Type.Literal("text"),
        prompt: Prompt,
        minLength: Type.Optional(NonNegativeInt),
        maxLength: Type.Optional(PositiveInt),
        multiline: Type.Optional(Type.Boolean()),
      },
      strict,
    ),
    Type.Object({ ...head, type: Type.Literal("single_choice"), prompt: Prompt, options: Options }, strict),
    Type.Object(
      {
        ...head,
        type: Type.Literal("multiple_choice"),
        prompt: Prompt,
        options: Options,
        minSelections: Type.Optional(NonNegativeInt),
        maxSelections: Type.Optional(PositiveInt),
      },
      strict,
    ),
    Type.Object(
      {
        ...head,
        type: Type.Literal("number"),
        prompt: Prompt,
        numberKind: Type.Union([Type.Literal("integer"), Type.Literal("float")]),
        /** Authored constants are JSON numbers; only answers are decimal strings (#42). */
        min: Type.Optional(Type.Number()),
        max: Type.Optional(Type.Number()),
        /** A display label, copied onto each answer by the server — never sent by the client. */
        unit: Type.Optional(Type.String({ minLength: 1 })),
      },
      strict,
    ),
    Type.Object(
      {
        ...head,
        type: Type.Literal("date"),
        prompt: Prompt,
        min: Type.Optional(IsoDate),
        max: Type.Optional(IsoDate),
        /** Resolved against a `today` the caller passes in — never a clock read by the evaluator. */
        relative: Type.Optional(Type.Union([Type.Literal("not_future"), Type.Literal("not_past")])),
      },
      strict,
    ),
  ]);
}

/** A question as a save request carries it: content only, identity assigned by the server. */
export const QuestionInput = questionUnion({});
export type QuestionInput = Static<typeof QuestionInput>;

/** A question as embedded in a published snapshot: one immutable question version, inline. */
export const QuestionContent = questionUnion({ questionId: Uuid, questionVersion: PositiveInt });
export type QuestionContent = Static<typeof QuestionContent>;

export type QuestionOf<T extends ResponseType> = Extract<QuestionContent, { type: T }>;

export const OTHER_OPTION_ID = "other";

type ChoiceType = "single_choice" | "multiple_choice";

export function isChoiceQuestion<Q extends { type: ResponseType }>(question: Q): question is Q & { type: ChoiceType } {
  return question.type === "single_choice" || question.type === "multiple_choice";
}

function isFreeformOther(option: Option): boolean {
  return option.optionId === OTHER_OPTION_ID && option.freeform === true;
}

export function optionIdsOf(question: QuestionInput): string[] {
  return isChoiceQuestion(question) ? question.options.map((option) => option.optionId) : [];
}

export function freeformOptionOf(question: QuestionInput): Option | undefined {
  return isChoiceQuestion(question) ? question.options.find(isFreeformOther) : undefined;
}

export function questionInputOf(content: QuestionContent): QuestionInput {
  const { questionId: _questionId, questionVersion: _questionVersion, ...input } = content;
  return input;
}

/** One append-only `question_version` row as the bank serves it (Decisions Log #13). */
export const QuestionVersion = questionUnion({
  questionId: Uuid,
  questionVersion: PositiveInt,
  createdAt: IsoDateTime,
  createdBy: Type.Union([Type.String(), Type.Null()]),
});
export type QuestionVersion = Static<typeof QuestionVersion>;

/** Version history is metadata only ([[7-application-boundary]] §4.1). */
export const QuestionVersionSummary = Type.Object(
  {
    questionVersion: PositiveInt,
    type: ResponseType,
    createdAt: IsoDateTime,
    createdBy: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type QuestionVersionSummary = Static<typeof QuestionVersionSummary>;

/** A bank entry: stable identity plus its latest version. Archived, never deleted (#15). */
export const Question = Type.Object(
  {
    questionId: Uuid,
    key: Type.Union([Slug, Type.Null()]),
    archivedAt: Type.Union([IsoDateTime, Type.Null()]),
    createdAt: IsoDateTime,
    latest: QuestionVersion,
  },
  { additionalProperties: false },
);
export type Question = Static<typeof Question>;

/** One row of `GET /questions/:questionId/usage`, read from `version_question_index`. */
export const QuestionUsage = Type.Object(
  { questionnaireId: Uuid, version: PositiveInt, questionVersion: PositiveInt },
  { additionalProperties: false },
);
export type QuestionUsage = Static<typeof QuestionUsage>;
