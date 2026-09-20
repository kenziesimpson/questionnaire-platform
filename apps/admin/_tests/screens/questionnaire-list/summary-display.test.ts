import type { QuestionnaireSummary } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { describe, expect, it } from "vitest";
import {
  fromLocalDateTimeInput,
  statusLabel,
  statusOf,
  toLocalDateTimeInput,
} from "../../../src/screens/questionnaire-list/summary-display";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");

const summary = (overrides: Partial<QuestionnaireSummary>): QuestionnaireSummary => ({
  questionnaireId: INTAKE_QUESTIONNAIRE_ID,
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
