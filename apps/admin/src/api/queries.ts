import { definitionApi, reportingApi, type SessionSort, type SessionStatus, type SortOrder } from "@qp/shared";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { callDefinition, callReporting, draftApi } from "./client";
import { queryKeys } from "./query-keys";

export const questionnaireQueries = {
  list: () =>
    queryOptions({
      queryKey: queryKeys.questionnaires.list(),
      queryFn: ({ signal }) => callDefinition(definitionApi.listQuestionnaires, { signal }),
    }),
  draft: (questionnaireId: string) =>
    queryOptions({
      queryKey: queryKeys.questionnaires.draft(questionnaireId),
      queryFn: ({ signal }) => draftApi.get(questionnaireId, signal),
    }),
  draftValidation: (questionnaireId: string) =>
    queryOptions({
      queryKey: queryKeys.questionnaires.draftValidation(questionnaireId),
      queryFn: ({ signal }) => callDefinition(definitionApi.validateDraft, { params: { id: questionnaireId }, signal }),
    }),
  versions: (questionnaireId: string) =>
    queryOptions({
      queryKey: queryKeys.questionnaires.versions(questionnaireId),
      queryFn: ({ signal }) => callDefinition(definitionApi.listVersions, { params: { id: questionnaireId }, signal }),
    }),
  version: (questionnaireId: string, version: number) =>
    queryOptions({
      queryKey: queryKeys.questionnaires.version(questionnaireId, version),
      queryFn: ({ signal }) =>
        callDefinition(definitionApi.getVersion, { params: { id: questionnaireId, v: version }, signal }),
      staleTime: Infinity,
    }),
};

export const questionQueries = {
  list: (includeArchived: boolean) =>
    queryOptions({
      queryKey: queryKeys.questions.list(includeArchived),
      queryFn: ({ signal }) => callDefinition(definitionApi.listQuestions, { query: { includeArchived }, signal }),
    }),
  usage: (questionId: string) =>
    queryOptions({
      queryKey: queryKeys.questions.usage(questionId),
      queryFn: ({ signal }) => callDefinition(definitionApi.getQuestionUsage, { params: { questionId }, signal }),
    }),
};

export interface ResponseListFilters {
  readonly version?: number;
  readonly status?: SessionStatus;
  readonly sort?: SessionSort;
  readonly order?: SortOrder;
  readonly cursor?: string;
}

export const responseQueries = {
  list: (questionnaireId: string, { version, status, sort, order, cursor }: ResponseListFilters) =>
    queryOptions({
      queryKey: queryKeys.responses.list(questionnaireId, { version, status, sort, order }, cursor),
      queryFn: ({ signal }) =>
        callReporting(reportingApi.listSessions, {
          params: { id: questionnaireId },
          query: { version, status, sort, order, cursor },
          signal,
        }),
      placeholderData: keepPreviousData,
    }),
  session: (questionnaireId: string, sessionId: string) =>
    queryOptions({
      queryKey: queryKeys.responses.session(questionnaireId, sessionId),
      queryFn: ({ signal }) => callReporting(reportingApi.getSessionDetail, { params: { id: questionnaireId, sessionId }, signal }),
      staleTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};
