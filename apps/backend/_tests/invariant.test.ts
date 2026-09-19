import { describe, expect, it } from "vitest";
import { InvariantViolation } from "../src/invariant.js";

describe("InvariantViolation", () => {
  it("carries its literal name and the ids it was given, and is an Error named for its class", () => {
    const violation = InvariantViolation.of("session.not-marked-submitted", { sessionId: "s-1", questionnaireVersion: 2 });

    expect(violation).toBeInstanceOf(Error);
    expect(violation.name).toBe("InvariantViolation");
    expect(violation.invariant).toBe("session.not-marked-submitted");
    expect(violation.ids).toEqual({ sessionId: "s-1", questionnaireVersion: 2 });
    expect(violation.message).toBe("session.not-marked-submitted");
  });

  it("has no ids unless it is given some", () => {
    expect(InvariantViolation.of("author.read-outside-author-hook").ids).toEqual({});
  });

  it("refuses a name built at runtime and a field that is not an id", () => {
    const value = "CANARY_DIABETES_8F3A" as string;
    // @ts-expect-error — an interpolated name is a pattern type, not a literal
    InvariantViolation.of(`row ${value} is missing`);
    // @ts-expect-error — nor is a name held in a `string` variable
    InvariantViolation.of(value);
    // @ts-expect-error — only the id fields are accepted
    InvariantViolation.of("session.not-marked-submitted", { status: 500 });
    // @ts-expect-error — the constructor is private
    expect(() => new InvariantViolation(value, {})).not.toThrow();
  });
});
