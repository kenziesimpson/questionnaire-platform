import { describe, expect, it } from "vitest";
import {
  compareDecimals,
  compareDecimalToNumber,
  decimalFromNumber,
  canonicalDecimal,
  isIntegerDecimal,
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

  it("treats a decimal whose canonical form has no fractional part as an integer", () => {
    expect(isIntegerDecimal("-12")).toBe(true);
    expect(isIntegerDecimal("12.0")).toBe(true);
    expect(isIntegerDecimal("12.000")).toBe(true);
    expect(isIntegerDecimal("12.01")).toBe(false);
    expect(isIntegerDecimal("1e3")).toBe(false);
  });

  it.each([
    ["72.50", "72.5"],
    ["72.500", "72.5"],
    ["72.5", "72.5"],
    ["72.0", "72"],
    ["100", "100"],
    ["-0", "0"],
    ["-0.0", "0"],
    ["0.000", "0"],
    ["-0.010", "-0.01"],
    ["-12.00", "-12"],
  ])("canonicalizes %s to %s: trailing fractional zeros and point stripped, no negative zero", (input, expected) => {
    expect(canonicalDecimal(input)).toBe(expected);
  });

  it("has no canonical form for anything that is not a wire decimal", () => {
    expect(canonicalDecimal("1e3")).toBeUndefined();
    expect(canonicalDecimal("01")).toBeUndefined();
  });
});
