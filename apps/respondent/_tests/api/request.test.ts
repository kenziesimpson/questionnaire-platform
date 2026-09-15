import { describe, expect, it } from "vitest";
import { pathOf } from "../../src/api/request.ts";

describe("pathOf", () => {
  it("substitutes each parameter, percent-encoded", () => {
    expect(pathOf("/sessions/:sessionId/submit", { sessionId: "a/b c" })).toBe("/sessions/a%2Fb%20c/submit");
  });

  it("throws naming the parameter, not its value, when one is missing", () => {
    expect(() => pathOf("/sessions/:sessionId", {})).toThrow("missing path parameter sessionId");
  });
});
