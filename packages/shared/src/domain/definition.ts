import Type, { type Static } from "typebox";
import { IsoDateTime, NonNegativeInt, PositiveInt, Slug, Uuid, strict } from "../primitives.js";
import { Predicate } from "./condition.js";
import { QuestionContent } from "./question.js";

export const FORMAT_VERSION = 1;

export const Item = Type.Object(
  {
    itemId: Slug,
    required: Type.Boolean(),
    visibleWhen: Type.Union([Predicate, Type.Null()]),
    question: QuestionContent,
  },
  strict,
);
export type Item = Static<typeof Item>;

export const PublishedDefinition = Type.Object(
  {
    formatVersion: Type.Literal(FORMAT_VERSION),
    questionnaireId: Uuid,
    version: PositiveInt,
    title: Type.String({ minLength: 1 }),
    items: Type.Array(Item),
  },
  strict,
);
export type PublishedDefinition = Static<typeof PublishedDefinition>;

export const VersionSummary = Type.Object(
  {
    questionnaireId: Uuid,
    version: PositiveInt,
    publishedAt: IsoDateTime,
    publishedBy: Type.Union([Type.String(), Type.Null()]),
    itemCount: NonNegativeInt,
    formatVersion: PositiveInt,
  },
  strict,
);
export type VersionSummary = Static<typeof VersionSummary>;
