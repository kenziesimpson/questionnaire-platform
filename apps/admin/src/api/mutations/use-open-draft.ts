import type { QuestionnaireSummary } from "@qp/shared";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { draftApi } from "../client";
import { isProblem } from "../problem-error";
import { questionnaireQueries } from "../queries";
import { queryKeys } from "../query-keys";

export type DraftTarget = Pick<QuestionnaireSummary, "questionnaireId" | "hasDraft">;

export interface OpenDraftFailure {
  questionnaireId: string;
  error: Error;
}

export interface OpenDraft {
  openDraft: (target: DraftTarget) => void;
  openingId: string | null;
  failure: OpenDraftFailure | null;
  dismissFailure: () => void;
}

async function ensureDraftIsOpen(queryClient: QueryClient, { questionnaireId, hasDraft }: DraftTarget): Promise<void> {
  if (hasDraft) return;
  const draftQuery = questionnaireQueries.draft(questionnaireId);
  try {
    queryClient.setQueryData(draftQuery.queryKey, await draftApi.open(questionnaireId));
  } catch (error) {
    if (!isProblem(error, "questionnaire/draft-exists")) throw error;
    await queryClient.fetchQuery({ ...draftQuery, staleTime: 0 });
  } finally {
    void queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.list() });
  }
}

export function useOpenDraft(): OpenDraft {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (target: DraftTarget) => ensureDraftIsOpen(queryClient, target),
    onSuccess: (_, { questionnaireId }) =>
      navigate({ to: "/questionnaires/$questionnaireId/draft", params: { questionnaireId } }),
  });
  const target = mutation.variables;

  return {
    openDraft: (next) => mutation.mutate(next),
    openingId: mutation.isPending && target ? target.questionnaireId : null,
    failure: mutation.isError && target ? { questionnaireId: target.questionnaireId, error: mutation.error } : null,
    dismissFailure: () => mutation.reset(),
  };
}
