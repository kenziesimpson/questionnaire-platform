import { describe, expect, it } from "vitest";
import { databaseErrorOf, mustExist, SQLSTATE } from "../../src/db/errors.js";

describe("mustExist", () => {
  it("returns the row the database answered with, including falsy rows", () => {
    const row = { id: "q-1" };

    expect(mustExist(row, "the questionnaire just created")).toBe(row);
    expect(mustExist(0, "a count")).toBe(0);
    expect(mustExist("", "a label")).toBe("");
  });

  it("throws naming the row when the database has neither a row nor a value", () => {
    expect(() => mustExist(undefined, "the draft just saved")).toThrow(new Error("the draft just saved is not in the database"));
    expect(() => mustExist(null, "a published version's version")).toThrow(
      new Error("a published version's version is not in the database"),
    );
  });
});

describe("databaseErrorOf", () => {
  it("reads the SQLSTATE and constraint name out of a wrapped driver error", () => {
    const driverError = Object.assign(new Error("duplicate key"), {
      code: SQLSTATE.uniqueViolation,
      constraint: "question_version_pkey",
    });

    expect(databaseErrorOf(new Error("query failed", { cause: driverError }))).toEqual({
      code: SQLSTATE.uniqueViolation,
      constraint: "question_version_pkey",
    });
  });

  it("is undefined for an error with no SQLSTATE anywhere in its cause chain", () => {
    expect(databaseErrorOf(new Error("boom", { cause: new Error("inner") }))).toBeUndefined();
    expect(databaseErrorOf("not an error")).toBeUndefined();
  });
});
