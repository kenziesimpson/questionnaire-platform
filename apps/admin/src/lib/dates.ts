const LOCALE = "en-GB";
const RELATIVE_LOCALE = "en";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const calendarDate = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short", year: "numeric" });
const calendarDateTime = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const relativeTime = new Intl.RelativeTimeFormat(RELATIVE_LOCALE, { numeric: "auto" });

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

export function calendarDateLabel(iso: string): string {
  return calendarDate.format(Date.parse(iso));
}
