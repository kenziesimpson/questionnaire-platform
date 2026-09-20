import { describe, expect, it } from "vitest";
import { FIELDS, scrubAttributes, scrubContext } from "../src/index.js";

describe("the finding count fields", () => {
  it.each(["findingCount", "omittedCount"] as const)("%s accepts a whole number from zero to a million and nothing else", (name) => {
    for (const accepted of [0, 1, 35, 1_000_000]) expect(FIELDS[name].accepts(accepted), String(accepted)).toBe(true);
    for (const refused of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001, "35", "LEAK_DIABETES_8F3A", null, undefined, [35], { count: 35 }]) {
      expect(FIELDS[name].accepts(refused), String(refused)).toBe(false);
    }
  });

  it("keeps a count in a log context and drops one that is text or fractional", () => {
    expect(scrubContext({ findingCount: 35, omittedCount: 15 }).attributes).toEqual({
      "questionnaire.finding_count": 35,
      "questionnaire.omitted_count": 15,
    });
    expect(scrubContext({ findingCount: "35", omittedCount: 1.5 }).dropped.invalid).toBe(2);
  });

  it("is not a metric label, so a count can never split a counter", () => {
    const result = scrubAttributes({ "questionnaire.finding_count": 35, "questionnaire.omitted_count": 15 }, "metric");
    expect(result.attributes).toEqual({});
    expect(result.dropped.unbounded).toBe(2);
  });
});
