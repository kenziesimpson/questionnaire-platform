import { problemType, type ProblemSlug } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { definitionProblem, type DefinitionRefusal } from "../../../src/modules/definition/problems.js";

const instance = "/api/definition/questionnaires/01a0950e-56a0-73d6-b936-4a1e10eff8c0/draft";

describe("definitionProblem", () => {
  it.each<[DefinitionRefusal, ProblemSlug, number]>([
    [{ outcome: "questionnaire-not-found" }, "resource/not-found", 404],
    [{ outcome: "question-not-found" }, "resource/not-found", 404],
    [{ outcome: "no-draft" }, "resource/not-found", 404],
    [{ outcome: "nothing-published" }, "resource/not-found", 404],
    [{ outcome: "stale" }, "questionnaire/draft-stale", 409],
    [{ outcome: "draft-exists" }, "questionnaire/draft-exists", 409],
  ])("answers %o with %s %i at the instance", (refusal, slug, status) => {
    expect(definitionProblem(refusal, instance)).toEqual({
      type: problemType(slug),
      title: expect.any(String),
      status,
      instance,
    });
  });

  it("answers invalid draft content with 422 draft-invalid naming each item, at the instance", () => {
    const items = [{ itemId: "itm_01", code: "draft/question-archived" as const }];

    expect(definitionProblem({ outcome: "invalid", items }, instance)).toMatchObject({
      type: problemType("questionnaire/draft-invalid"),
      status: 422,
      instance,
      items,
    });
  });

  it("answers a changed response type with 400 request/invalid pointing at the type, at the instance", () => {
    expect(definitionProblem({ outcome: "type-changed" }, instance)).toMatchObject({
      type: problemType("request/invalid"),
      status: 400,
      instance,
      errors: [{ pointer: "/body/question/type", code: "question/type-changed" }],
    });
  });
});
