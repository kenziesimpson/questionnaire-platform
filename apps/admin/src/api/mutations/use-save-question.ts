import { definitionApi, type QuestionInput, type QuestionVersion } from "@qp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callDefinition } from "../client";
import { queryKeys } from "../query-keys";

async function saveQuestion(questionId: string | undefined, question: QuestionInput): Promise<QuestionVersion> {
  if (questionId === undefined) {
    const created = await callDefinition(definitionApi.createQuestion, { body: { question } });
    return created.latest;
  }
  return callDefinition(definitionApi.createQuestionVersion, { params: { questionId }, body: { question } });
}

export function useSaveQuestion(questionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (question: QuestionInput) => saveQuestion(questionId, question),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.questions.all }),
  });
}
