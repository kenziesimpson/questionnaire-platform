import type { QuestionnaireSummary } from "@qp/shared";
import { fullTimestamp } from "../../lib/dates";

export type QuestionnaireStatus =
  | { kind: "never-published" }
  | { kind: "published"; version: number }
  | { kind: "closed"; version: number | null };

export function sortByMostRecentlyEdited(summaries: readonly QuestionnaireSummary[]): QuestionnaireSummary[] {
  return summaries.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function isClosed({ closesAt }: Pick<QuestionnaireSummary, "closesAt">, now: number): boolean {
  return closesAt !== null && Date.parse(closesAt) <= now;
}

export function statusOf(summary: QuestionnaireSummary, now: number): QuestionnaireStatus {
  if (isClosed(summary, now)) return { kind: "closed", version: summary.currentVersion };
  if (summary.currentVersion === null) return { kind: "never-published" };
  return { kind: "published", version: summary.currentVersion };
}

export function statusLabel(status: QuestionnaireStatus): string {
  switch (status.kind) {
    case "never-published":
      return "Never published";
    case "published":
      return `Published v${status.version}`;
    case "closed":
      return status.version === null ? "Closed" : `Closed at v${status.version}`;
  }
}

export function closesLabel({ closesAt, currentVersion }: QuestionnaireSummary): string {
  if (closesAt !== null) return fullTimestamp(closesAt);
  return currentVersion === null ? "—" : "Open-ended";
}

export function respondentLink(questionnaireId: string, origin: string = window.location.origin): string {
  return `${origin}/q/${questionnaireId}`;
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function toLocalDateTimeInput(instant: number): string {
  const at = new Date(instant);
  const date = `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`;
  return `${date}T${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
}

export function fromLocalDateTimeInput(value: string): string | null {
  const instant = new Date(value);
  return value === "" || Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}
