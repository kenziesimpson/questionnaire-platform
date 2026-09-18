import { definitionApi } from "@qp/shared";
import { queryOptions } from "@tanstack/react-query";
import { callDefinition, draftApi } from "./client";
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
