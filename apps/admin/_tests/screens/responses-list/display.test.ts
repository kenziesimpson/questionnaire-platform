import { describe, expect, it } from "vitest";
import { answeredSummary, shortSessionId, statusLabel } from "../../../src/screens/responses-list/display";

describe("statusLabel", () => {
  it.each([
    ["submitted", "Submitted"],
    ["in_progress", "In progress"],
  ] as const)("labels %s as %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });
});

describe("answeredSummary", () => {
  it("counts answers against items for a submitted session", () => {
    expect(answeredSummary({ status: "submitted", itemCount: 4, answeredCount: 4, hiddenCount: 0 })).toBe("4 of 4");
  });

  it("adds how many items the rules hid, so an unanswered-looking gap is explained", () => {
    expect(answeredSummary({ status: "submitted", itemCount: 4, answeredCount: 2, hiddenCount: 2 })).toBe("2 of 4 · 2 hidden by rules");
  });

  it("says nothing is stored for a session that has not been submitted, whatever the counts", () => {
    expect(answeredSummary({ status: "in_progress", itemCount: 4, answeredCount: 3, hiddenCount: 1 })).toBe("Not stored until submit");
  });
});

describe("shortSessionId", () => {
  it("keeps the first eight characters, which is the segment before the first hyphen of a uuid", () => {
    expect(shortSessionId("a1b2c3d4-0000-7000-8000-000000000001")).toBe("a1b2c3d4");
  });

  it("does not pad or throw on a shorter id", () => {
    expect(shortSessionId("abc")).toBe("abc");
  });
});
