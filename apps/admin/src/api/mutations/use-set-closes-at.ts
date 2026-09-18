import { definitionApi, type QuestionnaireSummary } from "@qp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callDefinition } from "../client";
import { questionnaireQueries } from "../queries";

function replaceSummary(summaries: QuestionnaireSummary[] | undefined, updated: QuestionnaireSummary) {
  return summaries?.map((summary) => (summary.questionnaireId === updated.questionnaireId ? updated : summary));
}

export function useSetClosesAt(questionnaireId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (closesAt: string | null) =>
      callDefinition(definitionApi.setClosesAt, { params: { id: questionnaireId }, body: { closesAt } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(questionnaireQueries.list().queryKey, (summaries) => replaceSummary(summaries, updated));
    },
  });
}
