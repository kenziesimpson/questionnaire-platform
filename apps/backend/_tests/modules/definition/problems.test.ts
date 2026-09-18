import { problemType, type ProblemSlug } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { definitionProblem, type DefinitionRefusal } from "../../../src/modules/definition/problems.js";

describe("definitionProblem", () => {
  it.each<[DefinitionRefusal, ProblemSlug, number]>([
    [{ outcome: "questionnaire-not-found" }, "resource/not-found", 404],
    [{ outcome: "question-not-found" }, "resource/not-found", 404],
    [{ outcome: "no-draft" }, "resource/not-found", 404],
    [{ outcome: "nothing-published" }, "resource/not-found", 404],
    [{ outcome: "stale" }, "questionnaire/draft-stale", 409],
    [{ outcome: "draft-exists" }, "questionnaire/draft-exists", 409],
  ])("answers %o with %s %i", (refusal, slug, status) => {
    expect(definitionProblem(refusal)).toEqual({
      type: problemType(slug),
      title: expect.any(String),
      status,
    });
  });

  it("answers invalid draft content with 422 draft-invalid naming each item", () => {
    const items = [{ itemId: "itm_01", code: "draft/question-archived" as const }];

    expect(definitionProblem({ outcome: "invalid", items })).toMatchObject({
      type: problemType("questionnaire/draft-invalid"),
      status: 422,
      items,
    });
  });

  it("answers a changed response type with 400 request/invalid pointing at the type", () => {
    expect(definitionProblem({ outcome: "type-changed" })).toMatchObject({
      type: problemType("request/invalid"),
      status: 400,
      errors: [{ pointer: "/body/question/type", code: "question/type-changed" }],
    });
  });
});
