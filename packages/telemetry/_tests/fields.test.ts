import { describe, expect, it } from "vitest";
import { COUNT_FIELDS, FIELDS } from "../src/fields.js";
import { scrubAttributes, scrubContext } from "../src/index.js";

describe("the count fields", () => {
  it("are the finding, omitted and per-code counts", () => {
    expect([...COUNT_FIELDS]).toEqual(["findingCount", "omittedCount", "codeFindingCount"]);
  });

  it.each(COUNT_FIELDS)("%s accepts a whole number from zero to a million and nothing else", (name) => {
    for (const accepted of [0, 1, 35, 1_000_000]) expect(FIELDS[name].accepts(accepted), String(accepted)).toBe(true);
    const refused = [-1, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001, BigInt(35), "35", "LEAK_DIABETES_8F3A", null, undefined, [35], { count: 35 }];
    for (const value of refused) expect(FIELDS[name].accepts(value), String(typeof value)).toBe(false);
  });

  it("keeps a count in a log context and drops one that is text or fractional", () => {
    expect(scrubContext({ findingCount: 35, omittedCount: 15, codeFindingCount: 20 }).attributes).toEqual({
      "questionnaire.finding_count": 35,
      "questionnaire.omitted_count": 15,
      "questionnaire.code_finding_count": 20,
    });
    expect(scrubContext({ findingCount: "35", omittedCount: 1.5, codeFindingCount: -1 }).dropped.invalid).toBe(3);
  });

  it("are not metric labels, so a count can never split a counter", () => {
    const result = scrubAttributes(
      { "questionnaire.finding_count": 35, "questionnaire.omitted_count": 15, "questionnaire.code_finding_count": 20 },
      "metric",
    );
    expect(result.attributes).toEqual({});
    expect(result.dropped.unbounded).toBe(3);
  });
});
