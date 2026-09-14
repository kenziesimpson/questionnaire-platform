import type { Static } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { validateDraft } from "../src/api/definition.js";
import { QuestionVersionSummary, RESPONSE_TYPES, ResponseType } from "../src/domain/question.js";
import { LiteralUnion } from "../src/primitives.js";
import {
  DRAFT_ITEM_CODES,
  PROBLEM_SLUGS,
  ProblemDetails,
  SUBMISSION_ITEM_CODES,
  problemType,
  type DraftItemCode,
  type ProblemType,
  type SubmissionItemCode,
} from "../src/problems.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ValidateDraftItemCode = Static<(typeof validateDraft)["schema"]["response"][200]>["items"][number]["code"];
type ProblemItemCode = NonNullable<Static<typeof ProblemDetails>["items"]>[number]["code"];

describe("LiteralUnion", () => {
  const Colour = LiteralUnion(["red", "green"] as const);

  it("emits one const per value, as a hand-written union of literals would", () => {
    expect(Colour.anyOf.map((member: { const: string }) => member.const)).toEqual(["red", "green"]);
  });

  it("accepts exactly the listed values", () => {
    expect(Value.Check(Colour, "red")).toBe(true);
    expect(Value.Check(Colour, "green")).toBe(true);
    expect(Value.Check(Colour, "blue")).toBe(false);
  });

  it("gives each contract union its value list as its static type, never `never`", () => {
    const exact: [
      Equal<Static<typeof Colour>, "red" | "green">,
      Equal<Static<typeof ResponseType>, ResponseType>,
      Equal<QuestionVersionSummary["type"], ResponseType>,
      Equal<ValidateDraftItemCode, DraftItemCode>,
      Equal<ProblemItemCode, DraftItemCode | SubmissionItemCode>,
      Equal<Static<typeof ProblemDetails>["type"], ProblemType>,
    ] = [true, true, true, true, true, true];

    expect(exact).not.toContain(false);
  });
});

describe("the contract unions at runtime", () => {
  it("ResponseType admits exactly RESPONSE_TYPES", () => {
    for (const type of RESPONSE_TYPES) expect(Value.Check(ResponseType, type)).toBe(true);
    expect(Value.Check(ResponseType, "yes_no")).toBe(false);
  });

  it("a validateDraft item admits every draft item code and no submission code", () => {
    const Item = validateDraft.schema.response[200].properties.items.items;
    for (const code of DRAFT_ITEM_CODES) expect(Value.Check(Item, { itemId: "itm_01", code })).toBe(true);
    expect(Value.Check(Item, { itemId: "itm_01", code: SUBMISSION_ITEM_CODES[0] })).toBe(false);
  });

  it("ProblemDetails.type admits the URL of every slug, whose type names that slug", () => {
    const versionImmutable: ProblemType<"version/immutable"> = problemType("version/immutable");
    expect(versionImmutable).toBe("https://qp.example/problems/version-immutable");
    for (const slug of PROBLEM_SLUGS) {
      expect(Value.Check(ProblemDetails.properties.type, problemType(slug))).toBe(true);
    }
    expect(Value.Check(ProblemDetails.properties.type, "https://qp.example/problems/unknown")).toBe(false);
  });
});
