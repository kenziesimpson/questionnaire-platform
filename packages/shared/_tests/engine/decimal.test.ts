import { describe, expect, it } from "vitest";
import {
  compareDecimals,
  compareDecimalToNumber,
  decimalFromNumber,
  isIntegerDecimal,
  withoutNegativeZero,
} from "../../src/engine/decimal.js";

describe("exact decimal comparison (#42)", () => {
  it.each([
    ["1", "2", -1],
    ["10", "9", 1],
    ["72.5", "72.50", 0],
    ["-0", "0", 0],
    ["-0.00", "0", 0],
    ["-1.5", "-1.25", -1],
    ["-2", "1", -1],
    ["0.30000000000000004", "0.3", 1],
    ["9007199254740993", "9007199254740992", 1],
  ])("%s vs %s → %i", (a, b, expected) => {
    expect(compareDecimals(a, b)).toBe(expected);
  });

  it("refuses to compare anything that is not a wire decimal", () => {
    expect(compareDecimals("1e3", "1000")).toBeUndefined();
    expect(compareDecimalToNumber("1", Number.NaN)).toBeUndefined();
  });

  it.each([
    [0.1, "0.1"],
    [1e21, "1000000000000000000000"],
    [1.5e-7, "0.00000015"],
    [-2.5e-8, "-0.000000025"],
    [123.456, "123.456"],
    [-0, "0"],
  ])("reads the authored constant %s as the decimal %s", (value, expected) => {
    expect(decimalFromNumber(value)).toBe(expected);
  });

  it("treats only a decimal without a point as an integer", () => {
    expect(isIntegerDecimal("-12")).toBe(true);
    expect(isIntegerDecimal("12.0")).toBe(false);
    expect(isIntegerDecimal("1e3")).toBe(false);
  });

  it("drops the sign from negative zero, which Postgres numeric does not store, and nothing else", () => {
    expect(withoutNegativeZero("-0")).toBe("0");
    expect(withoutNegativeZero("-0.00")).toBe("0.00");
    expect(withoutNegativeZero("-0.01")).toBe("-0.01");
    expect(withoutNegativeZero("72.50")).toBe("72.50");
  });
});
