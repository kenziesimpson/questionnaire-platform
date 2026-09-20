import type { QuestionnaireSummary } from "@qp/shared";
import { useQuery } from "@tanstack/react-query";
import { questionnaireQueries } from "./queries";

export interface QuestionnaireSummaryQuery {
  summary: QuestionnaireSummary | undefined;
  isPending: boolean;
}

export function useQuestionnaireSummary(questionnaireId: string): QuestionnaireSummaryQuery {
  const list = useQuery(questionnaireQueries.list());
  const summary = list.data?.find((candidate) => candidate.questionnaireId === questionnaireId);
  return { summary, isPending: list.isPending };
}
