import type { Question, QuestionUsage, QuestionnaireSummary } from "@qp/shared";
import { questionCount } from "../../components/counts";

export interface UsagePlacement {
  version: number;
  questionVersion: number;
}

export interface QuestionnaireUsage {
  questionnaireId: string;
  name: string | null;
  placements: UsagePlacement[];
}

export function sortByLatestEdit(questions: readonly Question[]): Question[] {
  return questions.toSorted((a, b) => Date.parse(b.latest.createdAt) - Date.parse(a.latest.createdAt));
}

export function isArchived(question: Pick<Question, "archivedAt">): boolean {
  return question.archivedAt !== null;
}

export function bankCountLabel(questions: readonly Question[]): string {
  const total = questionCount(questions.length);
  const archived = questions.filter(isArchived).length;
  return archived === 0 ? total : `${total}, ${archived} archived`;
}

export function groupUsage(
  usage: readonly QuestionUsage[],
  questionnaires: readonly QuestionnaireSummary[] | undefined,
): QuestionnaireUsage[] {
  const groups = new Map<string, QuestionnaireUsage>();
  for (const { questionnaireId, version, questionVersion } of usage) {
    const group = groups.get(questionnaireId) ?? {
      questionnaireId,
      name: questionnaires?.find((summary) => summary.questionnaireId === questionnaireId)?.name ?? null,
      placements: [],
    };
    group.placements.push({ version, questionVersion });
    groups.set(questionnaireId, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    placements: group.placements.toSorted((a, b) => a.version - b.version),
  }));
}
