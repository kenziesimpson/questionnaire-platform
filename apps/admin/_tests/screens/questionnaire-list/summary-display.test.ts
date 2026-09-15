import type { QuestionnaireSummary } from "@qp/shared";
import { describe, expect, it } from "vitest";
import {
  fromLocalDateTimeInput,
  lastEditedLabel,
  statusLabel,
  statusOf,
  toLocalDateTimeInput,
} from "../../../src/screens/questionnaire-list/summary-display";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");

const summary = (overrides: Partial<QuestionnaireSummary>): QuestionnaireSummary => ({
  questionnaireId: "01a0950e-56a0-73d6-b936-4a1e10eff8c0",
  key: null,
  name: "Patient Intake",
  currentVersion: 2,
  closesAt: null,
  hasDraft: false,
  createdAt: "2026-01-05T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
  ...overrides,
});

describe("a questionnaire's status", () => {
  it.each([
    ["published and open-ended", {}, "Published v2"],
    ["never published", { currentVersion: null }, "Never published"],
    ["closing later", { closesAt: "2026-09-14T12:00:01.000Z" }, "Published v2"],
    ["closed at the current instant", { closesAt: "2026-09-14T12:00:00.000Z" }, "Closed at v2"],
    ["closed before it was ever published", { currentVersion: null, closesAt: "2026-01-01T00:00:00.000Z" }, "Closed"],
  ])("reads %s", (_, overrides, label) => {
    expect(statusLabel(statusOf(summary(overrides), NOW))).toBe(label);
  });
});

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

describe("the closing-date input", () => {
  it("round-trips a local date and time through an ISO instant", () => {
    const iso = fromLocalDateTimeInput("2026-10-01T17:30");

    expect(iso).toBe(new Date("2026-10-01T17:30").toISOString());
    expect(toLocalDateTimeInput(Date.parse(iso ?? ""))).toBe("2026-10-01T17:30");
  });

  it("treats an empty or unparseable value as missing", () => {
    expect(fromLocalDateTimeInput("")).toBeNull();
    expect(fromLocalDateTimeInput("not a date")).toBeNull();
  });
});
