import Type, { type Static } from "typebox";
import { IsoDateTime, NonNegativeInt, PositiveInt, Slug, Uuid } from "../primitives.js";
import { Predicate } from "./condition.js";
import { QuestionContent } from "./question.js";
import { strict } from "./utils.js";

/**
 * The snapshot format this code writes. Stored snapshots are never rewritten; older formats are
 * upgraded in memory at read time ([[5-questionnaire-format]] §6.5).
 */
export const FORMAT_VERSION = 1;

/** A placement of one pinned question version. `required` and `visibleWhen` belong here, not on the question (#11). */
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

/**
 * The one artifact that crosses from definition to execution ([[7-application-boundary]] §2).
 * Self-contained: nothing in it needs resolving against another table.
 */
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

/** One row of version history — metadata only, no snapshot ([[7-application-boundary]] §4.2). */
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
