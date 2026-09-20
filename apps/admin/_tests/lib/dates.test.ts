import { describe, expect, it } from "vitest";
import { calendarDateLabel, calendarDayLabel, fullTimestamp, lastEditedLabel } from "../../src/lib/dates";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");

describe("the last-edited label", () => {
  it.each([
    ["2026-09-14T11:59:30.000Z", "just now"],
    ["2026-09-14T11:58:00.000Z", "2 minutes ago"],
    ["2026-09-14T09:00:00.000Z", "3 hours ago"],
    ["2026-09-13T11:00:00.000Z", "yesterday"],
    ["2026-09-10T12:00:00.000Z", "4 days ago"],
  ])("labels %s as %s", (updatedAt, label) => {
    expect(lastEditedLabel(updatedAt, NOW)).toBe(label);
  });

  it("falls back to a calendar date after a week", () => {
    expect(lastEditedLabel("2026-09-01T12:00:00.000Z", NOW)).toMatch(/^01 Sept? 2026$/);
  });
});

describe("fullTimestamp", () => {
  it("formats a calendar date and time in one locale", () => {
    expect(fullTimestamp("2026-09-14T12:00:00.000Z")).toMatch(/^14 Sept? 2026, \d{2}:\d{2}$/);
  });
});

describe("calendarDateLabel", () => {
  it("formats a calendar date alone, with no time of day, in the same locale as fullTimestamp", () => {
    expect(calendarDateLabel("2026-09-14T12:00:00.000Z")).toMatch(/^14 Sept? 2026$/);
  });
});

describe("calendarDayLabel", () => {
  it.each([
    ["2020-02-29", /^29 Feb 2020$/],
    ["2026-01-01", /^01 Jan 2026$/],
    ["2026-12-31", /^31 Dec 2026$/],
  ])("labels the calendar day %s as that day, whatever the viewer's time zone", (isoDate, label) => {
    expect(calendarDayLabel(isoDate)).toMatch(label);
  });
});
