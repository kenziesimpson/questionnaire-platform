import Type, { type Static } from "typebox";
import { IsoDateTime, PositiveInt, Slug, Uuid } from "../primitives.js";
import { Predicate } from "./condition.js";
import { QuestionVersion } from "./question.js";
import { strict } from "./utils.js";

/**
 * A draft item, normalized: it references its question by `(questionId, questionVersion)`. The
 * version is the one the author's screen displayed; the server never resolves "current" (#31).
 */
export const DraftItem = Type.Object(
  {
    itemId: Slug,
    required: Type.Boolean(),
    visibleWhen: Type.Union([Predicate, Type.Null()]),
    questionId: Uuid,
    questionVersion: PositiveInt,
  },
  strict,
);
export type DraftItem = Static<typeof DraftItem>;

/**
 * The working draft. `questions` carries each pinned question version once, beside the items
 * rather than inside them, so the editor can render types and operators without a request per item.
 * Concurrency travels in the `ETag` header, not the body (see `api/etag.ts`).
 */
export const QuestionnaireDraft = Type.Object(
  {
    questionnaireId: Uuid,
    versionId: Uuid,
    title: Type.String({ minLength: 1 }),
    updatedAt: IsoDateTime,
    items: Type.Array(DraftItem),
    questions: Type.Array(QuestionVersion),
  },
  strict,
);
export type QuestionnaireDraft = Static<typeof QuestionnaireDraft>;

/** One row of `GET /questionnaires`. `name` is the mutable admin label; `title` is versioned. */
export const QuestionnaireSummary = Type.Object(
  {
    questionnaireId: Uuid,
    key: Type.Union([Slug, Type.Null()]),
    name: Type.String({ minLength: 1 }),
    currentVersion: Type.Union([PositiveInt, Type.Null()]),
    closesAt: Type.Union([IsoDateTime, Type.Null()]),
    hasDraft: Type.Boolean(),
    createdAt: IsoDateTime,
  },
  strict,
);
export type QuestionnaireSummary = Static<typeof QuestionnaireSummary>;
