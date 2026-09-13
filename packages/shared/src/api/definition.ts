import Type from "typebox";
import { DRAFT_ITEM_CODES } from "../problems.js";
import { IsoDateTime, PositiveInt, Slug, Uuid } from "../primitives.js";
import { PublishedDefinition, VersionSummary } from "../domain/definition.js";
import { DraftItem, QuestionnaireDraft, QuestionnaireSummary } from "../domain/draft.js";
import {
  Question,
  QuestionInput,
  QuestionUsage,
  QuestionVersion,
  QuestionVersionSummary,
} from "../domain/question.js";
import { defineRoute } from "./route.js";

/**
 * The definition API, mounted at `/api/definition` — eighteen routes ([[7-application-boundary]] §4.1).
 * Every route sits behind the author `preHandler`. List order is fixed server-side (#40) and no
 * route paginates.
 */
export const DEFINITION_PREFIX = "/api/definition";

const strict = { additionalProperties: false } as const;
const QuestionParams = Type.Object({ questionId: Uuid }, strict);
const QuestionVersionParams = Type.Object({ questionId: Uuid, v: PositiveInt }, strict);
const QuestionnaireParams = Type.Object({ id: Uuid }, strict);
const QuestionnaireVersionParams = Type.Object({ id: Uuid, v: PositiveInt }, strict);

/** Headers are open objects: only the named header is constrained. A missing `If-Match` is a `400` (#43). */
const IfMatch = Type.Object({ "if-match": Type.String({ minLength: 1 }) });

// ── Question bank ────────────────────────────────────────────────────────────

/** Latest version of each question, `ORDER BY id DESC`. */
export const listQuestions = defineRoute({
  method: "GET",
  url: "/questions",
  schema: {
    querystring: Type.Object({ includeArchived: Type.Optional(Type.Boolean()) }, strict),
    response: { 200: Type.Array(Question) },
  },
});

/** Creates the question and writes version 1. */
export const createQuestion = defineRoute({
  method: "POST",
  url: "/questions",
  schema: {
    body: Type.Object({ key: Type.Optional(Slug), question: QuestionInput }, strict),
    response: { 201: Question },
  },
});

export const getQuestion = defineRoute({
  method: "GET",
  url: "/questions/:questionId",
  schema: { params: QuestionParams, response: { 200: Question } },
});

/** Metadata only, `ORDER BY version DESC`. */
export const listQuestionVersions = defineRoute({
  method: "GET",
  url: "/questions/:questionId/versions",
  schema: { params: QuestionParams, response: { 200: Type.Array(QuestionVersionSummary) } },
});

export const getQuestionVersion = defineRoute({
  method: "GET",
  url: "/questions/:questionId/versions/:v",
  schema: { params: QuestionVersionParams, response: { 200: QuestionVersion } },
});

/** Append-only: saving is publishing (#13). Serialized by a row lock; `409 question/version-conflict` is the safety net. */
export const createQuestionVersion = defineRoute({
  method: "POST",
  url: "/questions/:questionId/versions",
  schema: {
    params: QuestionParams,
    body: Type.Object({ question: QuestionInput }, strict),
    response: { 201: QuestionVersion },
  },
});

/** Hides the question from new placements; existing placements are unaffected. */
export const archiveQuestion = defineRoute({
  method: "POST",
  url: "/questions/:questionId/archive",
  schema: { params: QuestionParams, response: { 200: Question } },
});

/** Published versions embedding this question, `ORDER BY questionnaire_id, version DESC`. */
export const getQuestionUsage = defineRoute({
  method: "GET",
  url: "/questions/:questionId/usage",
  schema: { params: QuestionParams, response: { 200: Type.Array(QuestionUsage) } },
});

// ── Questionnaires ───────────────────────────────────────────────────────────

/** `ORDER BY id DESC`. */
export const listQuestionnaires = defineRoute({
  method: "GET",
  url: "/questionnaires",
  schema: { response: { 200: Type.Array(QuestionnaireSummary) } },
});

/** Creates the questionnaire and opens draft version 1 with `title`. */
export const createQuestionnaire = defineRoute({
  method: "POST",
  url: "/questionnaires",
  schema: {
    body: Type.Object(
      { name: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }), key: Type.Optional(Slug) },
      strict,
    ),
    response: { 201: QuestionnaireSummary },
  },
});

/** Responds with `ETag`; `Cache-Control: no-store`. */
export const getDraft = defineRoute({
  method: "GET",
  url: "/questionnaires/:id/draft",
  schema: { params: QuestionnaireParams, response: { 200: QuestionnaireDraft } },
});

/**
 * Replaces the whole draft — title, items, order, predicates — atomically. A stale `If-Match` is
 * `409 questionnaire/draft-stale`; an archived or unknown question version is `422 questionnaire/draft-invalid`.
 * Responds with the new `ETag`.
 */
export const replaceDraft = defineRoute({
  method: "PUT",
  url: "/questionnaires/:id/draft",
  schema: {
    params: QuestionnaireParams,
    headers: IfMatch,
    body: Type.Object({ title: Type.String({ minLength: 1 }), items: Type.Array(DraftItem) }, strict),
    response: { 200: QuestionnaireDraft },
  },
});

/** A dry run of publish validation through the same function publish calls. No writes. */
export const validateDraft = defineRoute({
  method: "POST",
  url: "/questionnaires/:id/draft/validate",
  schema: {
    params: QuestionnaireParams,
    response: {
      200: Type.Object(
        {
          valid: Type.Boolean(),
          items: Type.Array(
            Type.Object({ itemId: Slug, code: Type.Union(DRAFT_ITEM_CODES.map((c) => Type.Literal(c))) }, strict),
          ),
        },
        strict,
      ),
    },
  },
});

/**
 * Promotes the draft to version N in one transaction. Requires `If-Match`, so an author cannot
 * publish a draft another tab changed after they last read it.
 */
export const publishDraft = defineRoute({
  method: "POST",
  url: "/questionnaires/:id/publish",
  schema: { params: QuestionnaireParams, headers: IfMatch, response: { 201: VersionSummary } },
});

/** Opens the next draft as a copy of the latest published version. Responds with `ETag`. */
export const openDraft = defineRoute({
  method: "POST",
  url: "/questionnaires/:id/draft",
  schema: { params: QuestionnaireParams, response: { 201: QuestionnaireDraft } },
});

/** Version history, metadata only, `ORDER BY version DESC`. */
export const listVersions = defineRoute({
  method: "GET",
  url: "/questionnaires/:id/versions",
  schema: { params: QuestionnaireParams, response: { 200: Type.Array(VersionSummary) } },
});

/** One published snapshot, verbatim. `ETag` and `Cache-Control: private, max-age=31536000, immutable` (#44). */
export const getVersion = defineRoute({
  method: "GET",
  url: "/questionnaires/:id/versions/:v",
  schema: { params: QuestionnaireVersionParams, response: { 200: PublishedDefinition } },
});

/** Sets, reschedules or clears `closesAt`. Clearing undoes a premature retirement. */
export const setClosesAt = defineRoute({
  method: "PUT",
  url: "/questionnaires/:id/closes-at",
  schema: {
    params: QuestionnaireParams,
    body: Type.Object({ closesAt: Type.Union([IsoDateTime, Type.Null()]) }, strict),
    response: { 200: QuestionnaireSummary },
  },
});

export const definitionRoutes = [
  listQuestions,
  createQuestion,
  getQuestion,
  listQuestionVersions,
  getQuestionVersion,
  createQuestionVersion,
  archiveQuestion,
  getQuestionUsage,
  listQuestionnaires,
  createQuestionnaire,
  getDraft,
  replaceDraft,
  validateDraft,
  publishDraft,
  openDraft,
  listVersions,
  getVersion,
  setClosesAt,
] as const;
