import type { Question } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { isArchived, sortByLatestEdit } from "../../src/lib/question";
import { aBankQuestion, aQuestionVersion } from "../support/builders";

function aQuestion(questionId: string, latestCreatedAt: string, archivedAt: string | null = null): Question {
  return {
    ...aBankQuestion(aQuestionVersion({ type: "text", questionId, createdAt: latestCreatedAt })),
    archivedAt,
  };
}

describe("isArchived", () => {
  it("is true exactly when archivedAt is set", () => {
    expect(isArchived(aQuestion("01a0950e-56a0-73d6-b936-4a1e10eff9a1", "2026-09-10T09:00:00.000Z"))).toBe(false);
    expect(
      isArchived(aQuestion("01a0950e-56a0-73d6-b936-4a1e10eff9a2", "2026-09-10T09:00:00.000Z", "2026-09-11T09:00:00.000Z")),
    ).toBe(true);
  });
});

describe("sortByLatestEdit", () => {
  it("orders questions by their latest version's createdAt, newest first, keeping the server order for ties", () => {
    const questions = [
      aQuestion("01a0950e-56a0-73d6-b936-4a1e10eff9a3", "2026-09-10T09:00:00.000Z"),
      aQuestion("01a0950e-56a0-73d6-b936-4a1e10eff9a2", "2026-09-14T09:00:00.000Z"),
      aQuestion("01a0950e-56a0-73d6-b936-4a1e10eff9a1", "2026-09-10T09:00:00.000Z"),
    ];

    expect(sortByLatestEdit(questions).map((question) => question.questionId.slice(-1))).toEqual(["2", "3", "1"]);
    expect(questions.map((question) => question.questionId.slice(-1))).toEqual(["3", "2", "1"]);
  });
});
