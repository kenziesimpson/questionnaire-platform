import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, UUID_PATTERN, Uuid } from "../src/primitives.js";

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
