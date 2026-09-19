import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { RESPONSES_PAGE_SIZE, SessionDetail, SessionSummary, SessionSummaryPage } from "../../src/domain/session-report.js";

const summary = {
  sessionId: "01a0950e-56a0-73d6-b936-4a1e10eff8c1",
  questionnaireId: "01a0950e-56a0-73d6-b936-4a1e10eff8c0",
  version: 2,
  status: "submitted",
  startedAt: "2026-09-10T09:00:00.000Z",
  submittedAt: "2026-09-10T09:05:00.000Z",
  itemCount: 4,
  answeredCount: 2,
  hiddenCount: 2,
};

const detail = {
  sessionId: summary.sessionId,
  questionnaireId: summary.questionnaireId,
  questionnaireTitle: "Patient Intake",
  version: 2,
  status: "submitted",
  startedAt: summary.startedAt,
  submittedAt: summary.submittedAt,
  items: [
    {
      itemId: "itm_01",
      required: true,
      visibleWhen: null,
      question: {
        questionId: "01a0950f-4100-7fcc-8acc-05dc6b75ce33",
        questionVersion: 1,
        type: "text",
        prompt: "Preferred pharmacy",
        maxLength: 120,
      },
      visible: true,
      answer: {
        itemId: "itm_01",
        questionId: "01a0950f-4100-7fcc-8acc-05dc6b75ce33",
        questionVersion: 1,
        type: "text",
        text: "Corner Pharmacy",
      },
    },
  ],
};

describe("the page size", () => {
  it("is 20, the number the responses list shows and the keyset query fetches one more than", () => {
    expect(RESPONSES_PAGE_SIZE).toBe(20);
  });
});

describe("SessionSummary", () => {
  it("accepts a submitted session and an in-progress one with no submit time", () => {
    expect(Value.Check(SessionSummary, summary)).toBe(true);
    expect(Value.Check(SessionSummary, { ...summary, status: "in_progress", submittedAt: null, answeredCount: 0, hiddenCount: 0 })).toBe(true);
  });

  it.each([
    ["an unknown status", { status: "abandoned" }],
    ["a negative count", { answeredCount: -1 }],
    ["a fractional count", { hiddenCount: 0.5 }],
    ["version 0", { version: 0 }],
    ["a session id that is not a uuid", { sessionId: "a1b2c3d4" }],
    ["a submit time that is not a date-time", { submittedAt: "yesterday" }],
    ["a missing submit time, which must be null rather than absent", { submittedAt: undefined }],
  ])("rejects %s", (_, change) => {
    expect(Value.Check(SessionSummary, { ...summary, ...change })).toBe(false);
  });

  it("rejects a field it does not define, so an answer value cannot ride along on a list row", () => {
    expect(Value.Check(SessionSummary, { ...summary, answers: [] })).toBe(false);
  });
});

describe("SessionSummaryPage", () => {
  it("carries its neighbours as cursors or null, and has no total", () => {
    expect(Value.Check(SessionSummaryPage, { items: [summary], olderCursor: "abc", newerCursor: null })).toBe(true);
    expect(Value.Check(SessionSummaryPage, { items: [], olderCursor: null, newerCursor: null })).toBe(true);
    expect(Value.Check(SessionSummaryPage, { items: [], olderCursor: null, newerCursor: null, total: 0 })).toBe(false);
  });

  it("requires both cursors to be present, so a client can tell no page from a missing field", () => {
    expect(Value.Check(SessionSummaryPage, { items: [], olderCursor: null })).toBe(false);
  });
});

describe("SessionDetail", () => {
  it("accepts a session with an answered, visible item", () => {
    expect(Value.Check(SessionDetail, detail)).toBe(true);
  });

  it("accepts an item that was hidden or unanswered, which carries a null answer", () => {
    const [item] = detail.items;
    expect(Value.Check(SessionDetail, { ...detail, items: [{ ...item, visible: false, answer: null }] })).toBe(true);
  });

  it("rejects an answer that is not a stored response row", () => {
    const [item] = detail.items;
    expect(Value.Check(SessionDetail, { ...detail, items: [{ ...item, answer: { type: "text", text: "" } }] })).toBe(false);
  });

  it("rejects a field it does not define", () => {
    expect(Value.Check(SessionDetail, { ...detail, respondent: "someone" })).toBe(false);
  });
});
