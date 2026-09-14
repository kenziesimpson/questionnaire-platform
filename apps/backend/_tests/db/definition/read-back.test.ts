import { describe, expect, it } from "vitest";
import { readBack } from "../../../src/db/definition/read-back.js";

describe("readBack", () => {
  it("returns the row a write read back, including falsy rows", () => {
    const row = { id: "q-1" };

    expect(readBack(row, "the questionnaire just created")).toBe(row);
    expect(readBack(0, "a count")).toBe(0);
    expect(readBack(null, "a nullable column")).toBeNull();
  });

  it("throws naming what was written when the write's own transaction cannot read it back", () => {
    expect(() => readBack(undefined, "the draft just saved")).toThrow(
      new Error("the draft just saved could not be read back inside its own transaction"),
    );
  });
});
