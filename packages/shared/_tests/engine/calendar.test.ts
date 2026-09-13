import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientAnswerValue } from "../../src/domain/answer.js";
import type { QuestionContent } from "../../src/domain/question.js";
import { validateAnswer } from "../../src/engine/answer-validation.js";
import {
  addDays,
  calendarDateIn,
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
