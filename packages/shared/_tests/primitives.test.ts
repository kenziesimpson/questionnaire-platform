import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { DecimalString, IsoDate, IsoDateTime, NonNegativeInt, PositiveInt, SLUG_PATTERN, UUID_PATTERN, Uuid } from "../src/primitives.js";

const UUIDS = ["0f8fad5b-d9cb-469f-a165-70867728950e", "0F8FAD5B-D9CB-469F-A165-70867728950E", "00000000-0000-0000-0000-000000000000"];

const NOT_UUIDS = [
  "",
  "diabetes",
  "0f8fad5b-d9cb-469f-a165-70867728950",
  "0f8fad5b-d9cb-469f-a165-70867728950e0",
  "0f8fad5bd9cb469fa16570867728950e",
  "0f8fad5b-d9cb-469f-a165-70867728950g",
  " 0f8fad5b-d9cb-469f-a165-70867728950e",
  "0f8fad5b-d9cb-469f-a165-70867728950e\n",
];

describe("UUID_PATTERN", () => {
  it.each(UUIDS)("accepts %s, as the Uuid schema does", (value) => {
    expect(new RegExp(UUID_PATTERN).test(value)).toBe(true);
    expect(Value.Check(Uuid, value)).toBe(true);
  });

  it.each(NOT_UUIDS)("rejects %j, as the Uuid schema does", (value) => {
    expect(new RegExp(UUID_PATTERN).test(value)).toBe(false);
    expect(Value.Check(Uuid, value)).toBe(false);
  });
});

describe("SLUG_PATTERN", () => {
  it.each(["diabetes", "itm_02", "a"])("accepts %s", (value) => {
    expect(new RegExp(SLUG_PATTERN).test(value)).toBe(true);
  });

  it.each(["", "2fa", "Diabetes", "type-2", "two words", "a".repeat(65)])("rejects %j", (value) => {
    expect(new RegExp(SLUG_PATTERN).test(value)).toBe(false);
  });
});

describe("the integer bounds", () => {
  it.each([1, 2, 2_147_483_647])("accepts %d as a PositiveInt", (value) => {
    expect(Value.Check(PositiveInt, value)).toBe(true);
  });

  it.each([0, -1, 1.5, 2_147_483_648, 1e20])("rejects %d as a PositiveInt, so no integer column is handed a value it cannot hold", (value) => {
    expect(Value.Check(PositiveInt, value)).toBe(false);
  });

  it("bounds a NonNegativeInt at the same maximum, and accepts zero", () => {
    expect(Value.Check(NonNegativeInt, 0)).toBe(true);
    expect(Value.Check(NonNegativeInt, 2_147_483_647)).toBe(true);
    expect(Value.Check(NonNegativeInt, 2_147_483_648)).toBe(false);
  });
});

describe("the date bounds", () => {
  it.each(["0001-01-01", "2024-02-29", "9999-12-31"])("accepts the date %s", (value) => {
    expect(Value.Check(IsoDate, value)).toBe(true);
  });

  it.each(["0000-01-01", "0000-12-31", "10000-01-01", "2026-1-1", ""])("rejects the date %j", (value) => {
    expect(Value.Check(IsoDate, value)).toBe(false);
  });

  it.each(["2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00-08:00"])("accepts the timestamp %s", (value) => {
    expect(Value.Check(IsoDateTime, value)).toBe(true);
  });

  it.each(["0000-01-01T00:00:00Z", "2026-01-01T23:59:60Z", "2026-01-01t00:00:00z", "2026-01-01 00:00:00Z", "2026-01-01T00:00:00+0100", "2026-01-01T00:00:00"])(
    "rejects the timestamp %j",
    (value) => {
      expect(Value.Check(IsoDateTime, value)).toBe(false);
    },
  );
});

describe("DecimalString", () => {
  it("accepts a decimal of at most 64 characters and rejects a longer one, which numeric could not always hold", () => {
    expect(Value.Check(DecimalString, "9".repeat(64))).toBe(true);
    expect(Value.Check(DecimalString, "9".repeat(65))).toBe(false);
    expect(Value.Check(DecimalString, "-72.5")).toBe(true);
    expect(Value.Check(DecimalString, "1e3")).toBe(false);
  });
});
