import Type, { type Static } from "typebox";
import { DecimalString, IsoDate, PositiveInt, SLUG_PATTERN, Slug, Uuid, strict } from "../primitives.js";

const ClientOtherText = Type.Optional(Type.String());
const StoredOtherText = Type.Optional(Type.String({ minLength: 1 }));

export const ClientAnswerValue = Type.Union([
  Type.Object({ type: Type.Literal("text"), text: Type.String({ minLength: 1 }) }, strict),
  Type.Object({ type: Type.Literal("single_choice"), optionId: Slug, otherText: ClientOtherText }, strict),
  Type.Object(
    { type: Type.Literal("multiple_choice"), optionIds: Type.Array(Slug, { minItems: 1 }), otherText: ClientOtherText },
    strict,
  ),
  Type.Object({ type: Type.Literal("number"), value: DecimalString }, strict),
  Type.Object({ type: Type.Literal("date"), date: IsoDate }, strict),
]);
export type ClientAnswerValue = Static<typeof ClientAnswerValue>;
export type ClientAnswerValueOf<T extends ClientAnswerValue["type"]> = Extract<ClientAnswerValue, { type: T }>;

export const ClientAnswers = Type.Record(
  Type.String({ pattern: SLUG_PATTERN }),
  Type.Union([ClientAnswerValue, Type.Null()]),
  strict,
);
export type ClientAnswers = Static<typeof ClientAnswers>;

export function answerFor(answers: ClientAnswers, itemId: string): ClientAnswerValue | undefined {
  return Object.hasOwn(answers, itemId) ? (answers[itemId] ?? undefined) : undefined;
}

const RowHead = { itemId: Slug, questionId: Uuid, questionVersion: PositiveInt };

export const ResponseRow = Type.Union([
  Type.Object({ ...RowHead, type: Type.Literal("text"), text: Type.String({ minLength: 1 }) }, strict),
  Type.Object(
    {
      ...RowHead,
      type: Type.Literal("single_choice"),
      optionIds: Type.Array(Slug, { minItems: 1, maxItems: 1 }),
      otherText: StoredOtherText,
    },
    strict,
  ),
  Type.Object(
    { ...RowHead, type: Type.Literal("multiple_choice"), optionIds: Type.Array(Slug, { minItems: 1 }), otherText: StoredOtherText },
    strict,
  ),
  Type.Object(
    { ...RowHead, type: Type.Literal("number"), number: DecimalString, unit: Type.Optional(Type.String({ minLength: 1 })) },
    strict,
  ),
  Type.Object({ ...RowHead, type: Type.Literal("date"), date: IsoDate }, strict),
]);
export type ResponseRow = Static<typeof ResponseRow>;
