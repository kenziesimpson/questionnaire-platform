import Type, { type Static } from "typebox";
import { DecimalString, IsoDate, PositiveInt, SLUG_PATTERN, Slug, Uuid } from "../primitives.js";

const strict = { additionalProperties: false } as const;
const OtherText = Type.Optional(Type.String({ minLength: 1 }));

/**
 * One answer as the client sends it. `type` lets the server reject an answer shaped for the wrong
 * question with a named item rather than a schema failure. A number is a decimal string and carries
 * no unit — the server copies the unit from the pinned question version (#42).
 *
 * `optionIds` deliberately has no `uniqueItems`: a duplicate is the submit validator's `422` naming
 * the item, not a schema `400` (#34).
 */
export const AnswerValue = Type.Union([
  Type.Object({ type: Type.Literal("text"), text: Type.String({ minLength: 1 }) }, strict),
  Type.Object({ type: Type.Literal("single_choice"), optionId: Slug, otherText: OtherText }, strict),
  Type.Object(
    { type: Type.Literal("multiple_choice"), optionIds: Type.Array(Slug, { minItems: 1 }), otherText: OtherText },
    strict,
  ),
  Type.Object({ type: Type.Literal("number"), value: DecimalString }, strict),
  Type.Object({ type: Type.Literal("date"), date: IsoDate }, strict),
]);
export type AnswerValue = Static<typeof AnswerValue>;
export type AnswerValueOf<T extends AnswerValue["type"]> = Extract<AnswerValue, { type: T }>;

/**
 * Answers keyed by `itemId` (#41), so one answer per item is structural. An explicit `null` and an
 * absent key mean the same thing — unanswered — and canonicalize identically.
 */
export const Answers = Type.Record(Type.String({ pattern: SLUG_PATTERN }), Type.Union([AnswerValue, Type.Null()]), strict);
export type Answers = Static<typeof Answers>;

const RowHead = { itemId: Slug, questionId: Uuid, questionVersion: PositiveInt };

/**
 * A validated answer: exactly what one `execution.response` row persists, and the input to the
 * submit digest. Every field is stored, which keeps the digest a pure function of the rows (#37).
 * Choice answers carry `optionIds` for both choice types because that is the column.
 */
export const Answer = Type.Union([
  Type.Object({ ...RowHead, type: Type.Literal("text"), text: Type.String({ minLength: 1 }) }, strict),
  Type.Object(
    {
      ...RowHead,
      type: Type.Literal("single_choice"),
      optionIds: Type.Array(Slug, { minItems: 1, maxItems: 1 }),
      otherText: OtherText,
    },
    strict,
  ),
  Type.Object(
    { ...RowHead, type: Type.Literal("multiple_choice"), optionIds: Type.Array(Slug, { minItems: 1 }), otherText: OtherText },
    strict,
  ),
  Type.Object(
    { ...RowHead, type: Type.Literal("number"), number: DecimalString, unit: Type.Optional(Type.String({ minLength: 1 })) },
    strict,
  ),
  Type.Object({ ...RowHead, type: Type.Literal("date"), date: IsoDate }, strict),
]);
export type Answer = Static<typeof Answer>;
