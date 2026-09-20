import { describe, expect, it } from "vitest";
import { databaseErrorOf, mustExist, SQLSTATE } from "../../src/db/errors.js";
import { InvariantViolation } from "../../src/invariant.js";

describe("mustExist", () => {
  it("returns the row the database answered with, including falsy rows", () => {
    const row = { id: "q-1" };

    expect(mustExist(row, "questionnaire.unreadable-after-create")).toBe(row);
    expect(mustExist(0, "count.missing")).toBe(0);
    expect(mustExist("", "label.missing")).toBe("");
  });

  it("throws an invariant violation carrying the name and the ids it was given", () => {
    expect(() => mustExist(undefined, "draft.unreadable-after-save", { questionnaireId: "q-1" })).toThrow(
      expect.objectContaining({ name: "InvariantViolation", invariant: "draft.unreadable-after-save", ids: { questionnaireId: "q-1" } }),
    );
    expect(() => mustExist(null, "published-version.missing-version")).toThrow(InvariantViolation);
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
