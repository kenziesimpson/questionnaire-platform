import { describe, expect, it } from "vitest";
import { generateUnusedId, randomSuffix } from "../../src/components/generated-id";

describe("generateUnusedId", () => {
  it("draws eight lowercase base-36 characters", () => {
    expect(randomSuffix()).toMatch(/^[a-z0-9]{8}$/);
  });

  it("prefixes the suffix and draws again while the candidate is taken", () => {
    const suffixes = ["aaaaaaaa", "bbbbbbbb", "cccccccc"];

    const id = generateUnusedId("x_", new Set(["x_aaaaaaaa", "x_bbbbbbbb"]), () => suffixes.shift() ?? "zzzzzzzz");

    expect(id).toBe("x_cccccccc");
  });
});
