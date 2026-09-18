import type { Condition } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { stepCondition } from "../../../../src/screens/draft-editor/predicate-editor/condition-row";

const saved: Condition = { type: "number", itemId: "itm_per_day", op: "eq", value: 10 };

describe("stepCondition", () => {
  it("keeps editing an incomplete condition without committing it", () => {
    const incomplete: Condition = { type: "number", itemId: "itm_per_day", op: "eq", value: Number.NaN };
    expect(stepCondition(saved, incomplete)).toEqual({ kind: "editing", condition: incomplete });
  });

  it("settles without committing when the complete condition is unchanged from what was saved", () => {
    expect(stepCondition(saved, { ...saved })).toEqual({ kind: "settled" });
  });

  it("commits a complete condition that differs from what was saved", () => {
    const next: Condition = { ...saved, value: 12 };
    expect(stepCondition(saved, next)).toEqual({ kind: "commit", condition: next });
  });
});
