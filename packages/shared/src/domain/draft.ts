import Type, { type Static } from "typebox";
import { IsoDateTime, PositiveInt, Slug, Uuid, strict } from "../primitives.js";
import { Predicate } from "./condition.js";
import type { Item } from "./definition.js";
import { type QuestionContent, QuestionVersion } from "./question.js";

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

export function draftItemOf(item: Item): DraftItem {
  return {
    itemId: item.itemId,
    required: item.required,
    visibleWhen: item.visibleWhen,
    questionId: item.question.questionId,
    questionVersion: item.question.questionVersion,
  };
}

export interface DraftForValidation {
  items: readonly DraftItem[];
  questions: readonly QuestionContent[];
}

export function draftForValidation(items: readonly Item[]): DraftForValidation {
  return { items: items.map(draftItemOf), questions: items.map((item) => item.question) };
}

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
    updatedAt: IsoDateTime,
  },
  strict,
);
export type QuestionnaireSummary = Static<typeof QuestionnaireSummary>;
