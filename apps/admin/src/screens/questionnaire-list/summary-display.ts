import type { QuestionnaireSummary } from "@qp/shared";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const calendarDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const calendarDateTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

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
  if (closesAt !== null) return calendarDateTime.format(Date.parse(closesAt));
  return currentVersion === null ? "—" : "Open-ended";
}

export function lastEditedLabel(updatedAt: string, now: number): string {
  const elapsed = now - Date.parse(updatedAt);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return relativeTime.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relativeTime.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < WEEK) return relativeTime.format(-Math.floor(elapsed / DAY), "day");
  return calendarDate.format(Date.parse(updatedAt));
}

export function fullTimestamp(iso: string): string {
  return calendarDateTime.format(Date.parse(iso));
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function toLocalDateInput(instant: number): string {
  const at = new Date(instant);
  return `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`;
}

export function toLocalDateTimeInput(instant: number): string {
  const at = new Date(instant);
  return `${toLocalDateInput(instant)}T${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
}

export function fromLocalDateTimeInput(value: string): string | null {
  const instant = new Date(value);
  return value === "" || Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}
