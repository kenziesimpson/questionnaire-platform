import { SLUG_PATTERN } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { generateOptionId } from "../../../src/features/question-editor/option-ids";

describe("generateOptionId", () => {
  it("returns an opt_ slug with a random suffix that matches the shared option id pattern", () => {
    const ids = Array.from({ length: 50 }, () => generateOptionId(new Set()));

    ids.forEach((id) => expect(id).toMatch(new RegExp(SLUG_PATTERN)));
    ids.forEach((id) => expect(id).toMatch(/^opt_[a-z0-9]{8}$/));
    expect(new Set(ids).size).toBe(50);
  });

  it("draws again rather than return an id the question already holds", () => {
    const suffixes = ["aaaaaaaa", "bbbbbbbb", "cccccccc"];

    const id = generateOptionId(new Set(["opt_aaaaaaaa", "opt_bbbbbbbb"]), () => suffixes.shift() ?? "zzzzzzzz");

    expect(id).toBe("opt_cccccccc");
  });
});
