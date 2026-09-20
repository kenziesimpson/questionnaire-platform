import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientAnswerValue } from "../../src/domain/answer.js";
import type { QuestionContent } from "../../src/domain/question.js";
import { validateAnswer } from "../../src/engine/answer-validation.js";
import { IsoDate } from "../../src/primitives.js";
import {
  addDays,
  calendarDateIn,
  dayNumber,
  isoDateFromDayNumber,
  type RelativeDateContext,
  respondentDateContext,
  serverDateContext,
} from "../../src/engine/calendar.js";
import { anItem, questions } from "./fixtures.js";

const notFuture = anItem("itm_diagnosed", questions.date({ relative: "not_future" })).question as QuestionContent;
const notPast = anItem("itm_appointment", questions.date({ relative: "not_past" })).question as QuestionContent;
const on = (date: string): ClientAnswerValue => ({ type: "date", date });
const strictUtc = (now: Date): RelativeDateContext => ({ today: calendarDateIn(now, "UTC"), toleranceDays: 0 });

describe("calendar dates", () => {
  it.each([
    ["2026-09-13T20:00:00Z", "UTC", "2026-09-13"],
    ["2026-09-13T20:00:00Z", "Pacific/Tongatapu", "2026-09-14"],
    ["2026-09-14T06:00:00Z", "Pacific/Honolulu", "2026-09-13"],
    ["2026-12-31T23:30:00Z", "Asia/Tokyo", "2027-01-01"],
  ])("%s in %s is %s", (instant, timeZone, expected) => {
    expect(calendarDateIn(new Date(instant), timeZone)).toBe(expected);
  });

  it.each([
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-03-01", -1, "2026-02-28"],
  ])("%s shifted by %i day is %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it.each([
    ["0099-12-31", 1, "0100-01-01"],
    ["0000-01-01", 1, "0000-01-02"],
    ["0000-02-28", 1, "0000-02-29"],
    ["0100-02-28", 1, "0100-03-01"],
    ["0400-02-28", 1, "0400-02-29"],
    ["0001-01-01", -1, "0000-12-31"],
    ["9999-12-30", 1, "9999-12-31"],
  ])("years 0000–0099 are not shifted by the legacy 1900 offset: %s shifted by %i day is %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it("the date format admits years 0001–0099 and refuses 0000, which Postgres has no date for, so the calendar arithmetic must handle the years it admits", () => {
    for (const date of ["0001-01-01", "0099-12-31"]) expect(Value.Check(IsoDate, date)).toBe(true);
    expect(Value.Check(IsoDate, "0000-01-01")).toBe(false);
    expect(dayNumber("0100-01-01") - dayNumber("0099-12-31")).toBe(1);
    expect(dayNumber("0099-12-31")).not.toBe(dayNumber("1999-12-31"));
  });

  it("dayNumber agrees with the Unix epoch and round-trips through isoDateFromDayNumber from 0000 to 9999", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    for (let day = dayNumber("0000-01-01"); day <= dayNumber("9999-12-31"); day += 997) {
      const iso = isoDateFromDayNumber(day);
      expect(dayNumber(iso)).toBe(day);
      if (iso >= "0100-01-01") expect(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000).toBe(day);
    }
    expect(isoDateFromDayNumber(dayNumber("9999-12-31"))).toBe("9999-12-31");
  });

  it("the server resolves UTC today with one day of tolerance; the respondent resolves local today with none (#38)", () => {
    const now = new Date("2026-09-13T20:00:00Z");
    expect(serverDateContext(now)).toEqual({ today: "2026-09-13", toleranceDays: 1 });
    expect(respondentDateContext(now, "Pacific/Tongatapu")).toEqual({ today: "2026-09-14", toleranceDays: 0 });
  });
});

describe("relative date constraints across a timezone boundary (§2.4)", () => {
  describe("east of UTC: a respondent at UTC+13 on the morning of the 14th, when UTC is still the 13th", () => {
    const now = new Date("2026-09-13T20:00:00Z");
    const respondent = respondentDateContext(now, "Pacific/Tongatapu");
    const server = serverDateContext(now);

    it("their today passes not_future in the browser and on the server", () => {
      expect(validateAnswer(notFuture, on("2026-09-14"), respondent)).toEqual([]);
      expect(validateAnswer(notFuture, on("2026-09-14"), server)).toEqual([]);
    });

    it("a strict UTC comparison would reject their today — the outage the tolerance exists to prevent", () => {
      expect(validateAnswer(notFuture, on("2026-09-14"), strictUtc(now))).toEqual(["date/in-future"]);
    });

    it("their tomorrow is rejected by both", () => {
      expect(validateAnswer(notFuture, on("2026-09-15"), respondent)).toEqual(["date/in-future"]);
      expect(validateAnswer(notFuture, on("2026-09-15"), server)).toEqual(["date/in-future"]);
    });
  });

  describe("west of UTC: a respondent at UTC−10 on the evening of the 13th, when UTC is already the 14th", () => {
    const now = new Date("2026-09-14T06:00:00Z");
    const respondent = respondentDateContext(now, "Pacific/Honolulu");
    const server = serverDateContext(now);

    it("their today passes not_past in the browser and on the server", () => {
      expect(validateAnswer(notPast, on("2026-09-13"), respondent)).toEqual([]);
      expect(validateAnswer(notPast, on("2026-09-13"), server)).toEqual([]);
    });

    it("a strict UTC comparison would reject their today", () => {
      expect(validateAnswer(notPast, on("2026-09-13"), strictUtc(now))).toEqual(["date/in-past"]);
    });

    it("their yesterday is rejected by both", () => {
      expect(validateAnswer(notPast, on("2026-09-12"), respondent)).toEqual(["date/in-past"]);
      expect(validateAnswer(notPast, on("2026-09-12"), server)).toEqual(["date/in-past"]);
    });
  });

  it("relative constraints compare correctly in years 0000–0099", () => {
    const dates: RelativeDateContext = { today: "0099-12-31", toleranceDays: 1 };
    expect(validateAnswer(notFuture, on("0100-01-01"), dates)).toEqual([]);
    expect(validateAnswer(notFuture, on("0100-01-02"), dates)).toEqual(["date/in-future"]);
  });

  it("the tolerance admits at most one day beyond UTC today, across a year boundary", () => {
    const server = serverDateContext(new Date("2026-12-31T12:00:00Z"));
    expect(validateAnswer(notFuture, on("2027-01-01"), server)).toEqual([]);
    expect(validateAnswer(notFuture, on("2027-01-02"), server)).toEqual(["date/in-future"]);
    expect(validateAnswer(notPast, on("2026-12-30"), server)).toEqual([]);
    expect(validateAnswer(notPast, on("2026-12-29"), server)).toEqual(["date/in-past"]);
  });

  describe("the evaluator never reads a clock", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("gives the same answer whatever the system time is", () => {
      const dates: RelativeDateContext = { today: "2026-09-13", toleranceDays: 0 };
      for (const systemTime of ["1970-01-01T00:00:00Z", "2026-09-13T12:00:00Z", "2099-12-31T23:59:59Z"]) {
        vi.useFakeTimers({ now: new Date(systemTime) });
        expect(validateAnswer(notFuture, on("2026-09-14"), dates)).toEqual(["date/in-future"]);
        expect(validateAnswer(notFuture, on("2026-09-13"), dates)).toEqual([]);
        vi.useRealTimers();
      }
    });
  });
});
