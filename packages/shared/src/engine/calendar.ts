const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const DAYS_PER_400_YEARS = 146_097;
const DAYS_FROM_YEAR_ZERO_MARCH_TO_UNIX_EPOCH = 719_468;

export const SERVER_RELATIVE_DATE_TOLERANCE_DAYS = 1;

export interface RelativeDateContext {
  today: string;
  toleranceDays: number;
}

export function compareIsoDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function daysFromCivil(year: number, month: number, day: number): number {
  const yearStartingInMarch = month <= 2 ? year - 1 : year;
  const era = Math.floor(yearStartingInMarch / 400);
  const yearOfEra = yearStartingInMarch - era * 400;
  const monthFromMarch = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * DAYS_PER_400_YEARS + dayOfEra - DAYS_FROM_YEAR_ZERO_MARCH_TO_UNIX_EPOCH;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const shifted = days + DAYS_FROM_YEAR_ZERO_MARCH_TO_UNIX_EPOCH;
  const era = Math.floor(shifted / DAYS_PER_400_YEARS);
  const dayOfEra = shifted - era * DAYS_PER_400_YEARS;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153);
  const month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
  return {
    year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0),
    month,
    day: dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1,
  };
}

export function dayNumber(isoDate: string): number {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return Number.NaN;
  return daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isoDateFromDayNumber(dayCount: number): string {
  const { year, month, day } = civilFromDays(dayCount);
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
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
