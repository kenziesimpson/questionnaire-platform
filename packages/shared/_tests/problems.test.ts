import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { PROBLEMS, PROBLEM_SLUGS, ProblemDetails, problem, problemSlug, problemType } from "../src/problems.js";

describe("problem slugs", () => {
  it("is the closed set in [[7-application-boundary]] §6.1, with its statuses", () => {
    expect(Object.fromEntries(PROBLEM_SLUGS.map((s) => [s, PROBLEMS[s].status]))).toEqual({
      "request/invalid": 400,
      "resource/not-found": 404,
      "questionnaire/draft-invalid": 422,
      "questionnaire/draft-stale": 409,
      "questionnaire/draft-exists": 409,
      "version/immutable": 409,
      "questionnaire/closed": 409,
      "session/already-submitted": 409,
      "submission/invalid": 422,
      "question/version-conflict": 409,
      internal: 500,
    });
  });

  it("builds the type URI from §6.1's example and inverts it", () => {
    expect(problemType("version/immutable")).toBe("https://qp.example/problems/version-immutable");
    for (const slug of PROBLEM_SLUGS) expect(problemSlug(problemType(slug))).toBe(slug);
    expect(problemSlug("https://qp.example/problems/made-up")).toBeUndefined();
  });
});

describe("problem()", () => {
  it("builds bodies that satisfy the wire schema", () => {
    const bodies = [
      problem("resource/not-found", { instance: "/api/run/sessions/x" }),
      problem("questionnaire/draft-stale"),
      problem("request/invalid", { errors: [{ pointer: "/body/question/max", code: "question/min-exceeds-max" }] }),
      problem("questionnaire/draft-invalid", { items: [{ itemId: "itm_03", code: "predicate/forward-reference" }] }),
      problem("submission/invalid", { items: [{ itemId: "itm_03", code: "answer/not-visible" }] }),
      problem("internal", { detail: "4bf92f3577b34da6a3ce929d0e0e4736" }),
    ];
    for (const body of bodies) expect(Value.Check(ProblemDetails, body)).toBe(true);
  });

  it("requires each slug's extension members and admits no others", () => {
    // Compile-time assertions only; `npm run typecheck` fails if any directive goes unused.
    const _typeChecks = () => {
      // @ts-expect-error — a submission rejection must name its items
      problem("submission/invalid");
      // @ts-expect-error — a draft item code is not a submission item code
      problem("submission/invalid", { items: [{ itemId: "itm_01", code: "predicate/unsatisfiable" }] });
      // @ts-expect-error — an internal error must carry the correlation id
      problem("internal", {});
      // @ts-expect-error — slugs are closed
      problem("session/expired");
    };
    expect(_typeChecks).toBeTypeOf("function");
  });

  it("rejects a problem body carrying an answer value", () => {
    const leaky = { ...problem("submission/invalid", { items: [{ itemId: "itm_03", code: "date/in-future" }] }), value: "2027-01-01" };
    expect(Value.Check(ProblemDetails, leaky)).toBe(false);
  });
});
