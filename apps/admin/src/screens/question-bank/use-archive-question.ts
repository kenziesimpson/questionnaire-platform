import { definitionApi, type Question } from "@qp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callDefinition } from "../../api/client";
import { isProblem } from "../../api/problem-error";
import { questionQueries } from "../../api/queries";
import { queryKeys } from "../../api/query-keys";

function replaceQuestion(questions: Question[] | undefined, archived: Question): Question[] | undefined {
  return questions?.map((question) => (question.questionId === archived.questionId ? archived : question));
}

export function useArchiveQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (questionId: string) => callDefinition(definitionApi.archiveQuestion, { params: { questionId } }),
    onSuccess: (archived) => {
      queryClient.setQueryData(questionQueries.list(true).queryKey, (questions) => replaceQuestion(questions, archived));
      void queryClient.invalidateQueries({ queryKey: questionQueries.list(false).queryKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.questions.one(archived.questionId), exact: true });
    },
    onError: (error) => {
      if (isProblem(error, "resource/not-found")) {
        void queryClient.invalidateQueries({ queryKey: questionQueries.list(true).queryKey });
      }
    },
  });
}
