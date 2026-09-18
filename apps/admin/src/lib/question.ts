import type { Question, ResponseType } from "@qp/shared";

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  text: "Text",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  number: "Number",
  date: "Date",
};

export function isArchived(question: Pick<Question, "archivedAt">): boolean {
  return question.archivedAt !== null;
}

export function sortByLatestEdit(questions: readonly Question[]): Question[] {
  return questions.toSorted((a, b) => Date.parse(b.latest.createdAt) - Date.parse(a.latest.createdAt));
}
