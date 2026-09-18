import { describe, expect, it } from "vitest";
import { hasAnyAnswer, isRetryable } from "../../src/session/failure.ts";
import type { FailureReason } from "../../src/session/respondent-state.ts";

describe("isRetryable", () => {
  it.each<[string, FailureReason, boolean]>([
    ["a network error", { kind: "network-error" }, true],
    ["an unexpected 503", { kind: "unexpected-response", status: 503 }, true],
    ["an unparseable 200", { kind: "unexpected-response", status: 200 }, true],
    ["an internal problem", { kind: "problem", slug: "internal" }, true],
    ["request/invalid", { kind: "problem", slug: "request/invalid" }, false],
    ["resource/not-found", { kind: "problem", slug: "resource/not-found" }, false],
    ["questionnaire/closed", { kind: "problem", slug: "questionnaire/closed" }, false],
    ["session/already-submitted", { kind: "problem", slug: "session/already-submitted" }, false],
    ["submission/invalid", { kind: "problem", slug: "submission/invalid" }, false],
  ])("%s → %s", (_case, reason, retryable) => {
    expect(isRetryable(reason)).toBe(retryable);
  });
});

describe("hasAnyAnswer", () => {
  it("is false when every stored answer is null", () => {
    expect(hasAnyAnswer({ itm_01: null, itm_02: null })).toBe(false);
  });

  it("is false for an empty answer map", () => {
    expect(hasAnyAnswer({})).toBe(false);
  });

  it("is true once at least one answer is not null", () => {
    expect(hasAnyAnswer({ itm_01: null, itm_02: { type: "text", text: "hi" } })).toBe(true);
  });
});
