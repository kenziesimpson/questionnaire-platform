import { definitionApi, type RouteDefinition } from "@qp/shared";
import { urlOf, type RouteParts } from "@qp/ui/testing";
import { QUESTIONNAIRE_ID } from "./builders";

const definitionUrlOf = (route: RouteDefinition, parts?: RouteParts) => urlOf(definitionApi.DEFINITION_PREFIX, route, parts);

const ofTheQuestionnaire = { params: { id: QUESTIONNAIRE_ID } };

const ofQuestion = (questionId: string) => ({ params: { questionId } });

export const LIST_URL = definitionUrlOf(definitionApi.listQuestionnaires);
export const QUESTIONS_URL = definitionUrlOf(definitionApi.createQuestion);
export const BANK_URL = definitionUrlOf(definitionApi.listQuestions, { query: { includeArchived: true } });
export const ACTIVE_BANK_URL = definitionUrlOf(definitionApi.listQuestions, { query: { includeArchived: false } });
export const DRAFT_URL = definitionUrlOf(definitionApi.getDraft, ofTheQuestionnaire);
export const VALIDATE_URL = definitionUrlOf(definitionApi.validateDraft, ofTheQuestionnaire);
export const PUBLISH_URL = definitionUrlOf(definitionApi.publishDraft, ofTheQuestionnaire);
export const VERSIONS_URL = definitionUrlOf(definitionApi.listVersions, ofTheQuestionnaire);

export const questionUrl = (questionId: string) => definitionUrlOf(definitionApi.getQuestion, ofQuestion(questionId));
export const questionVersionsUrl = (questionId: string) => definitionUrlOf(definitionApi.createQuestionVersion, ofQuestion(questionId));
export const usageUrl = (questionId: string) => definitionUrlOf(definitionApi.getQuestionUsage, ofQuestion(questionId));
export const versionUrl = (version: number) => definitionUrlOf(definitionApi.getVersion, { params: { id: QUESTIONNAIRE_ID, v: version } });
