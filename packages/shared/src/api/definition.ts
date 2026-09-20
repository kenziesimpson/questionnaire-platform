import Type from "typebox";
import { DRAFT_ITEM_CODES, ItemErrorOf } from "../problems.js";
import { IsoDateTime, PositiveInt, Slug, Uuid, strict } from "../primitives.js";
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

export const DEFINITION_PREFIX = "/api/definition";

const QuestionParams = Type.Object({ questionId: Uuid }, strict);
const QuestionVersionParams = Type.Object({ questionId: Uuid, v: PositiveInt }, strict);
const QuestionnaireParams = Type.Object({ id: Uuid }, strict);
const QuestionnaireVersionParams = Type.Object({ id: Uuid, v: PositiveInt }, strict);

const IfMatch = Type.Object({ "if-match": Type.String({ minLength: 1 }) });

export const listQuestions = defineRoute({
  method: "GET",
  url: "/questions",
  schema: {
    querystring: Type.Object({ includeArchived: Type.Optional(Type.Boolean()) }, strict),
    response: { 200: Type.Array(Question) },
  },
});

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

export const createQuestionVersion = defineRoute({
  method: "POST",
  url: "/questions/:questionId/versions",
  schema: {
    params: QuestionParams,
    body: Type.Object({ question: QuestionInput }, strict),
    response: { 201: QuestionVersion },
  },
});

export const archiveQuestion = defineRoute({
  method: "POST",
  url: "/questions/:questionId/archive",
  schema: { params: QuestionParams, response: { 200: Question } },
});

export const getQuestionUsage = defineRoute({
  method: "GET",
  url: "/questions/:questionId/usage",
  schema: { params: QuestionParams, response: { 200: Type.Array(QuestionUsage) } },
});

export const listQuestionnaires = defineRoute({
  method: "GET",
  url: "/questionnaires",
  schema: { response: { 200: Type.Array(QuestionnaireSummary) } },
});

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

export const getDraft = defineRoute({
  method: "GET",
  url: "/questionnaires/:id/draft",
  schema: { params: QuestionnaireParams, response: { 200: QuestionnaireDraft } },
});

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

export const validateDraft = defineRoute({
  method: "POST",
  url: "/questionnaires/:id/draft/validate",
  schema: {
    params: QuestionnaireParams,
    response: {
      200: Type.Object(
        {
          valid: Type.Boolean(),
          items: Type.Array(ItemErrorOf(DRAFT_ITEM_CODES)),
        },
        strict,
      ),
    },
  },
});

export const publishDraft = defineRoute({
  method: "POST",
  url: "/questionnaires/:id/publish",
  schema: { params: QuestionnaireParams, headers: IfMatch, response: { 201: VersionSummary } },
});

export const openDraft = defineRoute({
  method: "POST",
  url: "/questionnaires/:id/draft",
  schema: { params: QuestionnaireParams, response: { 201: QuestionnaireDraft } },
});

export const listVersions = defineRoute({
  method: "GET",
  url: "/questionnaires/:id/versions",
  schema: { params: QuestionnaireParams, response: { 200: Type.Array(VersionSummary) } },
});

export const getVersion = defineRoute({
  method: "GET",
  url: "/questionnaires/:id/versions/:v",
  schema: { params: QuestionnaireVersionParams, response: { 200: PublishedDefinition } },
});

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
