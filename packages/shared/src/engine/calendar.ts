const MILLISECONDS_PER_DAY = 86_400_000;
const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

export const SERVER_RELATIVE_DATE_TOLERANCE_DAYS = 1;

export interface RelativeDateContext {
  today: string;
  toleranceDays: number;
}

export function dayNumber(isoDate: string): number {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MILLISECONDS_PER_DAY;
}

export function isoDateFromDayNumber(day: number): string {
  return new Date(day * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  return isoDateFromDayNumber(dayNumber(isoDate) + days);
}

export function calendarDateIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

export function serverDateContext(now: Date): RelativeDateContext {
  return { today: calendarDateIn(now, "UTC"), toleranceDays: SERVER_RELATIVE_DATE_TOLERANCE_DAYS };
}

export function respondentDateContext(now: Date, timeZone: string): RelativeDateContext {
  return { today: calendarDateIn(now, timeZone), toleranceDays: 0 };
}
