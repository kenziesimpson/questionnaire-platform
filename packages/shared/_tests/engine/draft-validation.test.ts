import { describe, expect, it } from "vitest";
import type { Condition, Predicate } from "../../src/domain/condition.js";
import type { Item } from "../../src/domain/definition.js";
import { draftForValidation } from "../../src/domain/draft.js";
import type { QuestionInput } from "../../src/domain/question.js";
import { intakeDefinition } from "../../src/demo/intake.js";
import { validateDraft } from "../../src/engine/draft-validation.js";
import { DRAFT_ITEM_CODES } from "../../src/problems.js";
import { aDefinition, all, anItem, any, questions } from "./fixtures.js";

function problemsOf(items: Item[]) {
  return validateDraft(draftForValidation(items)).items;
}

function targetProblems(source: QuestionInput, visibleWhen: Predicate) {
  return problemsOf([anItem("src", source), anItem("target", questions.text(), { visibleWhen })]);
}

const onSrc = <C extends Omit<Condition, "itemId">>(condition: C) => ({ ...condition, itemId: "src" }) as Condition;

describe("validateDraft — the demo", () => {
  it.each([1, 2] as const)("accepts version %s", (version) => {
    expect(validateDraft(draftForValidation(intakeDefinition(version).items))).toEqual({ valid: true, items: [] });
  });
});

describe("validateDraft — placements (§5.5, #41)", () => {
  it("rejects a repeated itemId", () => {
    expect(problemsOf([anItem("itm_01", questions.text()), { ...anItem("itm_02", questions.text()), itemId: "itm_01" }])).toEqual([
      { itemId: "itm_01", code: "draft/duplicate-item-id" },
    ]);
  });

  it("rejects a question placed twice, naming the later placement", () => {
    const first = anItem("itm_01", questions.text());
    const second = { ...first, itemId: "itm_02" };
    expect(problemsOf([first, second])).toEqual([{ itemId: "itm_02", code: "draft/duplicate-question" }]);
  });

  it("rejects an item pinning a question version the caller could not resolve", () => {
    const draft = draftForValidation([anItem("itm_01", questions.text()), anItem("itm_02", questions.text())]);
    const unresolved = { ...draft, questions: draft.questions.slice(0, 1) };
    expect(validateDraft(unresolved)).toEqual({ valid: false, items: [{ itemId: "itm_02", code: "draft/question-version-unknown" }] });
  });
});

describe("validateDraft — referential integrity and forward references (§5.2, §5.4)", () => {
  const yesNo = anItem("itm_01", questions.yesNo());

  it.each<[string, Item[], string]>([
    [
      "a reference to a later item",
      [anItem("itm_00", questions.text(), { visibleWhen: all({ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }) }), yesNo],
      "predicate/forward-reference",
    ],
    [
      "a reference to itself",
      [anItem("itm_00", questions.yesNo(), { visibleWhen: all({ type: "single_choice", itemId: "itm_00", op: "is", optionId: "yes" }) })],
      "predicate/forward-reference",
    ],
    [
      "a reference to an item not in the version",
      [yesNo, anItem("itm_00", questions.text(), { visibleWhen: any({ type: "single_choice", itemId: "itm_99", op: "is", optionId: "yes" }) })],
      "predicate/unknown-item",
    ],
    [
      "a condition typed differently from the referenced question",
      [yesNo, anItem("itm_00", questions.text(), { visibleWhen: all({ type: "multiple_choice", itemId: "itm_01", op: "includes", optionId: "yes" }) })],
      "predicate/type-mismatch",
    ],
    [
      "an option id the referenced question does not have",
      [yesNo, anItem("itm_00", questions.text(), { visibleWhen: all({ type: "single_choice", itemId: "itm_01", op: "is", optionId: "maybe" }) })],
      "predicate/unknown-option",
    ],
    [
      "an unknown option id inside a list operand",
      [yesNo, anItem("itm_00", questions.text(), { visibleWhen: all({ type: "single_choice", itemId: "itm_01", op: "isAnyOf", optionIds: ["yes", "maybe"] }) })],
      "predicate/unknown-option",
    ],
  ])("rejects %s", (_, items, code) => {
    expect(problemsOf(items)).toEqual([{ itemId: "itm_00", code }]);
  });

  it("reports a referential problem alone, without a satisfiability verdict it cannot make", () => {
    const items = [
      anItem("itm_01", questions.yesNo()),
      anItem("itm_00", questions.text(), {
        visibleWhen: all(
          { type: "single_choice", itemId: "itm_99", op: "is", optionId: "yes" },
          { type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" },
          { type: "single_choice", itemId: "itm_01", op: "is", optionId: "no" },
        ),
      }),
    ];
    expect(problemsOf(items)).toEqual([{ itemId: "itm_00", code: "predicate/unknown-item" }]);
  });

  it("does not pile predicate codes onto an item that depends on an unresolved question version", () => {
    const draft = draftForValidation([
      anItem("itm_01", questions.yesNo()),
      anItem("itm_02", questions.text(), { visibleWhen: all({ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }) }),
    ]);
    expect(validateDraft({ ...draft, questions: draft.questions.slice(1) }).items).toEqual([
      { itemId: "itm_01", code: "draft/question-version-unknown" },
    ]);
  });
});

describe("validateDraft — exact satisfiability by domain intersection (§5.3)", () => {
  it.each<[string, QuestionInput, Predicate, boolean]>([
    ["text answered true and answered false", questions.text(), all(onSrc({ type: "text", op: "answered", value: true }), onSrc({ type: "text", op: "answered", value: false })), false],
    ["text answered true alone", questions.text(), all(onSrc({ type: "text", op: "answered", value: true })), true],
    ["text answered false alone", questions.text(), all(onSrc({ type: "text", op: "answered", value: false })), true],
    ["text answered false twice", questions.text(), all(onSrc({ type: "text", op: "answered", value: false }), onSrc({ type: "text", op: "answered", value: false })), true],
    ["text answered true twice", questions.text(), all(onSrc({ type: "text", op: "answered", value: true }), onSrc({ type: "text", op: "answered", value: true })), true],
    ["text answered true or answered false", questions.text(), any(onSrc({ type: "text", op: "answered", value: true }), onSrc({ type: "text", op: "answered", value: false })), true],
    ["single_choice is a and is b", questions.single(), all(onSrc({ type: "single_choice", op: "is", optionId: "a" }), onSrc({ type: "single_choice", op: "is", optionId: "b" })), false],
    ["single_choice is a and isNot b", questions.single(), all(onSrc({ type: "single_choice", op: "is", optionId: "a" }), onSrc({ type: "single_choice", op: "isNot", optionId: "b" })), true],
    ["single_choice isAnyOf [a] and isNoneOf [a, b]", questions.single(), all(onSrc({ type: "single_choice", op: "isAnyOf", optionIds: ["a"] }), onSrc({ type: "single_choice", op: "isNoneOf", optionIds: ["a", "b"] })), false],
    [
      "single_choice isNot every option",
      questions.yesNo(),
      all(onSrc({ type: "single_choice", op: "isNot", optionId: "yes" }), onSrc({ type: "single_choice", op: "isNot", optionId: "no" })),
      false,
    ],
    ["multiple_choice includes a and excludes a", questions.multiple(), all(onSrc({ type: "multiple_choice", op: "includes", optionId: "a" }), onSrc({ type: "multiple_choice", op: "excludes", optionId: "a" })), false],
    ["multiple_choice includes a and includes b", questions.multiple(), all(onSrc({ type: "multiple_choice", op: "includes", optionId: "a" }), onSrc({ type: "multiple_choice", op: "includes", optionId: "b" })), true],
    ["multiple_choice required set exceeds maxSelections", questions.multiple({ maxSelections: 2 }), all(onSrc({ type: "multiple_choice", op: "includesAllOf", optionIds: ["a", "b", "c"] })), false],
    [
      "multiple_choice fewer unforbidden options than minSelections",
      questions.multiple({ minSelections: 3, optionIds: ["a", "b", "c"] }),
      all(onSrc({ type: "multiple_choice", op: "excludes", optionId: "a" })),
      false,
    ],
    [
      "multiple_choice excluding every option",
      questions.multiple({ optionIds: ["a", "b"] }),
      all(onSrc({ type: "multiple_choice", op: "excludes", optionId: "a" }), onSrc({ type: "multiple_choice", op: "excludes", optionId: "b" })),
      false,
    ],
    [
      "multiple_choice includesAnyOf wholly forbidden",
      questions.multiple(),
      all(onSrc({ type: "multiple_choice", op: "includesAnyOf", optionIds: ["a", "b"] }), onSrc({ type: "multiple_choice", op: "excludes", optionId: "a" }), onSrc({ type: "multiple_choice", op: "excludes", optionId: "b" })),
      false,
    ],
    [
      "multiple_choice two disjoint includesAnyOf under maxSelections 1",
      questions.multiple({ maxSelections: 1 }),
      all(onSrc({ type: "multiple_choice", op: "includesAnyOf", optionIds: ["a", "b"] }), onSrc({ type: "multiple_choice", op: "includesAnyOf", optionIds: ["c", "other"] })),
      false,
    ],
    [
      "multiple_choice two overlapping includesAnyOf under maxSelections 1",
      questions.multiple({ maxSelections: 1 }),
      all(onSrc({ type: "multiple_choice", op: "includesAnyOf", optionIds: ["a", "b"] }), onSrc({ type: "multiple_choice", op: "includesAnyOf", optionIds: ["b", "c"] })),
      true,
    ],
    ["number gt 5 and lt 5", questions.number(), all(onSrc({ type: "number", op: "gt", value: 5 }), onSrc({ type: "number", op: "lt", value: 5 })), false],
    ["number gte 5 and lte 5", questions.number(), all(onSrc({ type: "number", op: "gte", value: 5 }), onSrc({ type: "number", op: "lte", value: 5 })), true],
    ["number gte 5 and lte 5 and neq 5", questions.number(), all(onSrc({ type: "number", op: "gte", value: 5 }), onSrc({ type: "number", op: "lte", value: 5 }), onSrc({ type: "number", op: "neq", value: 5 })), false],
    ["number eq 3 and neq 3", questions.number(), all(onSrc({ type: "number", op: "eq", value: 3 }), onSrc({ type: "number", op: "neq", value: 3 })), false],
    ["number between with min above max", questions.number(), all({ type: "number", itemId: "src", op: "between", min: 10, max: 1 }), false],
    ["number gt 1 and lt 2 on a float question", questions.number(), all(onSrc({ type: "number", op: "gt", value: 1 }), onSrc({ type: "number", op: "lt", value: 2 })), true],
    ["number gt 1 and lt 2 on an integer question", questions.number({ numberKind: "integer" }), all(onSrc({ type: "number", op: "gt", value: 1 }), onSrc({ type: "number", op: "lt", value: 2 })), false],
    [
      "number every integer in range punctured",
      questions.number({ numberKind: "integer" }),
      all({ type: "number", itemId: "src", op: "between", min: 1, max: 2 }, onSrc({ type: "number", op: "neq", value: 1 }), onSrc({ type: "number", op: "neq", value: 2 })),
      false,
    ],
    ["number eq 5.5 on an integer question", questions.number({ numberKind: "integer" }), all(onSrc({ type: "number", op: "eq", value: 5.5 })), false],
    ["number gt the question's own max", questions.number({ max: 100 }), all(onSrc({ type: "number", op: "gt", value: 100 })), false],
    ["number gte the question's own max", questions.number({ max: 100 }), all(onSrc({ type: "number", op: "gte", value: 100 })), true],
    [
      "date after 0099-12-31 and before 0100-01-02 (one day, no 1900 offset)",
      questions.date(),
      all(onSrc({ type: "date", op: "after", date: "0099-12-31" }), onSrc({ type: "date", op: "before", date: "0100-01-02" })),
      true,
    ],
    [
      "date after 0099-12-31 and before 0100-01-01 (years below 100 are not shifted)",
      questions.date(),
      all(onSrc({ type: "date", op: "after", date: "0099-12-31" }), onSrc({ type: "date", op: "before", date: "0100-01-01" })),
      false,
    ],
    ["date after the 1st and before the 2nd (dates are discrete)", questions.date(), all(onSrc({ type: "date", op: "after", date: "2020-01-01" }), onSrc({ type: "date", op: "before", date: "2020-01-02" })), false],
    ["date onOrAfter and onOrBefore the same day", questions.date(), all(onSrc({ type: "date", op: "onOrAfter", date: "2020-01-01" }), onSrc({ type: "date", op: "onOrBefore", date: "2020-01-01" })), true],
    ["date between with min after max", questions.date(), all({ type: "date", itemId: "src", op: "between", min: "2021-01-01", max: "2020-01-01" }), false],
    ["date after the question's own max", questions.date({ max: "2026-12-31" }), all(onSrc({ type: "date", op: "after", date: "2026-12-31" })), false],
    ["date after a far-future day on a not_future question (relative constraints excluded)", questions.date({ relative: "not_future" }), all(onSrc({ type: "date", op: "after", date: "2999-01-01" })), true],
    ["any with one satisfiable disjunct", questions.number(), any({ type: "number", itemId: "src", op: "between", min: 10, max: 1 }, onSrc({ type: "number", op: "gt", value: 1 })), true],
    ["any with no satisfiable disjunct", questions.number(), any({ type: "number", itemId: "src", op: "between", min: 10, max: 1 }), false],
    ["an empty any", questions.number(), { any: [] }, false],
    ["an empty all", questions.number(), { all: [] }, true],
  ])("%s → satisfiable: %s", (_, source, visibleWhen, satisfiable) => {
    expect(targetProblems(source, visibleWhen)).toEqual(satisfiable ? [] : [{ itemId: "target", code: "predicate/unsatisfiable" }]);
  });
});

describe("validateDraft — reachability through the dependency closure (§5.3)", () => {
  const is = (itemId: string, optionId: string): Condition => ({ type: "single_choice", itemId, op: "is", optionId });

  it("rejects an item whose predicate is satisfiable alone but contradicts what its references need to be shown", () => {
    const items = [
      anItem("itm_01", questions.yesNo()),
      anItem("itm_02", questions.single(), { visibleWhen: all(is("itm_01", "yes")) }),
      anItem("itm_03", questions.text(), { visibleWhen: all(is("itm_01", "no"), is("itm_02", "a")) }),
    ];
    expect(problemsOf(items)).toEqual([{ itemId: "itm_03", code: "draft/unreachable" }]);
  });

  it("propagates through a chain three deep", () => {
    const items = [
      anItem("itm_01", questions.yesNo()),
      anItem("itm_02", questions.yesNo(), { visibleWhen: all(is("itm_01", "yes")) }),
      anItem("itm_03", questions.yesNo(), { visibleWhen: all(is("itm_02", "yes")) }),
      anItem("itm_04", questions.text(), { visibleWhen: all(is("itm_03", "yes"), is("itm_01", "no")) }),
    ];
    expect(problemsOf(items)).toEqual([{ itemId: "itm_04", code: "draft/unreachable" }]);
  });

  it("accepts the item when an any-group gives a referenced item a second way to be shown", () => {
    const items = [
      anItem("itm_01", questions.yesNo()),
      anItem("itm_02", questions.yesNo()),
      anItem("itm_03", questions.single(), { visibleWhen: any(is("itm_01", "yes"), is("itm_02", "yes")) }),
      anItem("itm_04", questions.text(), { visibleWhen: all(is("itm_01", "no"), is("itm_03", "a")) }),
    ];
    expect(problemsOf(items)).toEqual([]);
  });

  it("rejects the item when every disjunct of the referenced any-group contradicts it", () => {
    const items = [
      anItem("itm_01", questions.yesNo()),
      anItem("itm_03", questions.single(), { visibleWhen: any(is("itm_01", "yes"), { type: "single_choice", itemId: "itm_01", op: "isAnyOf", optionIds: ["yes"] }) }),
      anItem("itm_04", questions.text(), { visibleWhen: all(is("itm_01", "no"), is("itm_03", "a")) }),
    ];
    expect(problemsOf(items)).toEqual([{ itemId: "itm_04", code: "draft/unreachable" }]);
  });

  it("marks dependants of an unsatisfiable item unreachable, and the item itself unsatisfiable", () => {
    const items = [
      anItem("itm_01", questions.yesNo()),
      anItem("itm_02", questions.yesNo(), { visibleWhen: all(is("itm_01", "yes"), is("itm_01", "no")) }),
      anItem("itm_03", questions.text(), { visibleWhen: all(is("itm_02", "yes")) }),
    ];
    expect(problemsOf(items)).toEqual([
      { itemId: "itm_02", code: "predicate/unsatisfiable" },
      { itemId: "itm_03", code: "draft/unreachable" },
    ]);
  });

  it("requires a text item to be shown for answered false, so it inherits that item's gate", () => {
    const items = [
      anItem("itm_01", questions.yesNo()),
      anItem("itm_02", questions.text(), { visibleWhen: all(is("itm_01", "yes")) }),
      anItem("itm_03", questions.text(), { visibleWhen: all({ type: "text", itemId: "itm_02", op: "answered", value: false }, is("itm_01", "no")) }),
    ];
    expect(problemsOf(items)).toEqual([{ itemId: "itm_03", code: "draft/unreachable" }]);
  });
});

describe("validateDraft — output", () => {
  it("lists problems in item order, then in the order of the closed code set, each once", () => {
    const repeated = anItem("itm_02", questions.yesNo());
    const items = [
      anItem("itm_01", questions.text(), { visibleWhen: all({ type: "single_choice", itemId: "itm_02", op: "is", optionId: "yes" }) }),
      repeated,
      { ...repeated, visibleWhen: all({ type: "single_choice", itemId: "itm_02", op: "is", optionId: "maybe" }) },
    ];
    const result = problemsOf(items);
    expect(result).toEqual([
      { itemId: "itm_01", code: "predicate/forward-reference" },
      { itemId: "itm_02", code: "draft/duplicate-item-id" },
      { itemId: "itm_02", code: "draft/duplicate-question" },
      { itemId: "itm_02", code: "predicate/unknown-option" },
    ]);
    for (const problem of result) expect(DRAFT_ITEM_CODES).toContain(problem.code);
  });
});
