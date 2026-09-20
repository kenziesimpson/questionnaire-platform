import { definitionApi } from "@qp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { callDefinition } from "../client";
import { queryKeys } from "../query-keys";

export interface NewQuestionnaire {
  name: string;
  title: string;
}

export function useCreateQuestionnaire() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (body: NewQuestionnaire) => callDefinition(definitionApi.createQuestionnaire, { body }),
    onSuccess: async ({ questionnaireId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.list() });
      await navigate({ to: "/questionnaires/$questionnaireId/draft", params: { questionnaireId } });
    },
  });
}
