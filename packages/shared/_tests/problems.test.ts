import type { Static } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  DRAFT_ITEM_CODES,
  PROBLEMS,
  PROBLEM_SLUGS,
  ProblemDetails,
  QUESTION_RULE_CODES,
  SUBMISSION_ITEM_CODES,
  PROBLEM_EXTENSION_MEMBERS,
  problem,
  problemFromWire,
  problemSlug,
  problemType,
  type DraftItemCode,
  type ProblemType,
  type SubmissionItemCode,
} from "../src/problems.js";
import type { Equal } from "./type-equality.js";

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

describe("question rule codes", () => {
  it("is the closed set of question rules, including the type lock", () => {
    expect([...QUESTION_RULE_CODES]).toEqual([
      "question/min-exceeds-max",
      "question/min-length-exceeds-max-length",
      "question/min-selections-exceeds-max-selections",
      "question/selections-exceed-options",
      "question/duplicate-option-id",
      "question/freeform-not-other",
      "question/type-changed",
    ]);
  });

  it("carries question/type-changed in the request/invalid errors extension on the wire", () => {
    const body = problem("request/invalid", { errors: [{ pointer: "/body/question/type", code: "question/type-changed" }] });
    expect(Value.Check(ProblemDetails, body)).toBe(true);
  });
});

describe("item codes", () => {
  it("is the closed set of submission item codes", () => {
    expect([...SUBMISSION_ITEM_CODES]).toEqual([
      "answer/required",
      "answer/not-visible",
      "answer/unknown-item",
      "answer/type-mismatch",
      "text/too-short",
      "text/too-long",
      "choice/unknown-option",
      "choice/duplicate-option",
      "choice/too-few",
      "choice/too-many",
      "choice/other-text-without-other",
      "choice/other-text-required",
      "number/not-integer",
      "number/out-of-range",
      "date/out-of-range",
      "date/in-future",
      "date/in-past",
    ]);
  });

  it("is the closed set of draft item codes", () => {
    expect([...DRAFT_ITEM_CODES]).toEqual([
      "draft/duplicate-item-id",
      "draft/duplicate-question",
      "draft/question-archived",
      "draft/question-version-unknown",
      "draft/unreachable",
      "predicate/forward-reference",
      "predicate/unknown-item",
      "predicate/unknown-option",
      "predicate/type-mismatch",
      "predicate/unsatisfiable",
    ]);
  });

  it("admits choice/other-text-required on the wire", () => {
    const body = problem("submission/invalid", { items: [{ itemId: "itm_02", code: "choice/other-text-required" }] });
    expect(Value.Check(ProblemDetails, body)).toBe(true);
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

describe("ProblemDetails closed unions", () => {
  it("types `type` as the problem URLs and `items[].code` as the item codes, never `never`", () => {
    type ItemCode = NonNullable<Static<typeof ProblemDetails>["items"]>[number]["code"];
    const exact: [Equal<Static<typeof ProblemDetails>["type"], ProblemType>, Equal<ItemCode, DraftItemCode | SubmissionItemCode>] = [true, true];

    expect(exact).not.toContain(false);
  });

  it("types problemType's result as the URL of that slug", () => {
    const versionImmutable: ProblemType<"version/immutable"> = problemType("version/immutable");

    expect(versionImmutable).toBe("https://qp.example/problems/version-immutable");
  });

  it("admits the URL of every slug and every item code, and nothing else", () => {
    for (const slug of PROBLEM_SLUGS) expect(Value.Check(ProblemDetails.properties.type, problemType(slug))).toBe(true);
    expect(Value.Check(ProblemDetails.properties.type, "https://qp.example/problems/unknown")).toBe(false);

    const Item = ProblemDetails.properties.items.items;
    for (const code of [...DRAFT_ITEM_CODES, ...SUBMISSION_ITEM_CODES]) expect(Value.Check(Item, { itemId: "itm_01", code })).toBe(true);
    expect(Value.Check(Item, { itemId: "itm_01", code: "schema/required" })).toBe(false);
  });
});

describe("problemFromWire", () => {
  const wire = (body: object) => ({ title: "t", status: 400, ...body });

  it("reads a slug with no extensions, keeping detail and instance and omitting the ones the body left out", () => {
    const body = { ...problem("resource/not-found", { instance: "/api/run/sessions/x" }) };

    expect(problemFromWire(body)).toEqual({ slug: "resource/not-found", problem: body });
    expect(problemFromWire(problem("questionnaire/draft-stale"))).toEqual({
      slug: "questionnaire/draft-stale",
      problem: problem("questionnaire/draft-stale"),
    });
  });

  it("reads each extension-carrying slug back into its typed members", () => {
    const requestInvalid = problem("request/invalid", { errors: [{ pointer: "/body/question/max", code: "question/min-exceeds-max" }] });
    const draftInvalid = problem("questionnaire/draft-invalid", { items: [{ itemId: "itm_03", code: "predicate/forward-reference" }] });
    const submissionInvalid = problem("submission/invalid", { items: [{ itemId: "itm_03", code: "answer/not-visible" }] });
    const internal = problem("internal", { detail: "4bf92f3577b34da6a3ce929d0e0e4736" });

    for (const body of [requestInvalid, draftInvalid, submissionInvalid, internal]) {
      expect(problemFromWire(body)?.problem).toEqual(body);
    }
  });

  it.each([
    ["a body that is not problem+json", { title: "t", status: 404 }],
    ["a body carrying an answer value", { ...problem("resource/not-found"), value: "2027-01-01" }],
    ["a type outside the closed slug union", wire({ type: "https://example.com/other" })],
  ])("answers undefined for %s", (_, body) => {
    expect(problemFromWire(body)).toBeUndefined();
  });

  const oneKnownItem = problem("submission/invalid", { items: [{ itemId: "itm_01", code: "answer/required" }] });

  it.each([
    ["a code this build has never heard of, as a newer server would send", "answer/invented-tomorrow"],
    ["a code the contract knows but this slug cannot carry", "predicate/unsatisfiable"],
  ])("refuses the whole body over %s, rather than rendering a partial list (#81)", (_, unknown) => {
    const body = { ...oneKnownItem, items: [{ itemId: "itm_01", code: "answer/required" }, { itemId: "itm_02", code: unknown }] };

    expect(problemFromWire(body)).toBeUndefined();
  });

  it("refuses the whole body over a pointer code this build has never heard of", () => {
    const known = { pointer: "/body/question/max", code: "question/min-exceeds-max" } as const;
    const body = { ...problem("request/invalid", { errors: [known] }), errors: [known, { pointer: "/body/x", code: "invented/tomorrow" }] };

    expect(problemFromWire(body)).toBeUndefined();
  });

  it("refuses a slug whose required extension the body left out", () => {
    const noItems = wire({ type: problemType("submission/invalid"), status: 422 });
    const noErrors = wire({ type: problemType("request/invalid") });
    const noDetail = wire({ type: problemType("internal"), status: 500 });

    for (const body of [noItems, noErrors, noDetail]) expect(problemFromWire(body)).toBeUndefined();
  });

  it("refuses a body whose envelope is wrong, which is a different failure from an unknown code", () => {
    const badItemId = { ...oneKnownItem, items: [{ itemId: "NOT A SLUG", code: "answer/required" }] };
    const badStatus = { ...problem("resource/not-found"), status: 200 };
    const extraMember = { ...problem("resource/not-found"), hints: [] };

    for (const body of [badItemId, badStatus, extraMember]) expect(problemFromWire(body)).toBeUndefined();
  });

  it("takes the title and status from the slug, never from the body", () => {
    const lying = { ...problem("questionnaire/closed"), title: "Gone", status: 410 };

    expect(problemFromWire(lying)?.problem).toEqual(problem("questionnaire/closed"));
  });

  it("keeps the slug and its body correlated, so a consumer can switch on one and read the other", () => {
    const parsed = problemFromWire(problem("submission/invalid", { items: [{ itemId: "itm_01", code: "choice/too-many" }] }));

    expect(parsed?.slug === "submission/invalid" && parsed.problem.items).toEqual([{ itemId: "itm_01", code: "choice/too-many" }]);
  });

  it("leaves the closed contract schema closed, so a route still refuses to serialize an unknown code", () => {
    const body = { ...oneKnownItem, items: [{ itemId: "itm_02", code: "answer/invented-tomorrow" }] };

    expect(Value.Check(ProblemDetails, body)).toBe(false);
  });
});

describe("the wire schema and the parser stay in step", () => {
  const BASE_MEMBERS = ["type", "title", "status", "detail", "instance"];

  it("reads every member ProblemDetails declares beyond the base ones", () => {
    const declared = Object.keys(ProblemDetails.properties).filter((member) => !BASE_MEMBERS.includes(member));
    const read = new Set<string>(Object.values(PROBLEM_EXTENSION_MEMBERS).flat());

    expect(declared).not.toEqual([]);
    expect(declared.filter((member) => !read.has(member))).toEqual([]);
  });

  it("names a reader for every slug that carries extensions", () => {
    expect(Object.keys(PROBLEM_EXTENSION_MEMBERS).every((slug) => PROBLEM_SLUGS.some((known) => known === slug))).toBe(true);
  });
});
