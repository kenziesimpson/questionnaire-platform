import type { TSchema } from "typebox";
import { describe, expect, it } from "vitest";
import { Condition, OPERATORS_BY_TYPE, conditionsOf, referencedOptionIds, type Predicate } from "../../src/domain/condition.js";
import { RESPONSE_TYPES } from "../../src/domain/question.js";
import { conditions } from "../engine/operator-table.js";

interface SchemaNode {
  anyOf?: SchemaNode[];
  const?: string;
  properties?: { type?: SchemaNode; op?: SchemaNode };
}

function constsOf(node: SchemaNode | undefined): string[] {
  if (node === undefined) return [];
  if (node.const !== undefined) return [node.const];
  return (node.anyOf ?? []).flatMap(constsOf);
}

function objectsOf(node: SchemaNode): SchemaNode[] {
  return node.anyOf === undefined ? [node] : node.anyOf.flatMap(objectsOf);
}

function operatorsTheSchemaAdmits(schema: TSchema): Record<string, string[]> {
  const byType: Record<string, string[]> = {};
  for (const object of objectsOf(schema as SchemaNode)) {
    for (const type of constsOf(object.properties?.type)) {
      byType[type] = [...(byType[type] ?? []), ...constsOf(object.properties?.op)];
    }
  }
  return byType;
}

describe("OPERATORS_BY_TYPE", () => {
  it("offers exactly the operators format §4.2 allows per type, in the editor's order", () => {
    expect(OPERATORS_BY_TYPE).toEqual({
      text: ["answered"],
      single_choice: ["is", "isNot", "isAnyOf", "isNoneOf"],
      multiple_choice: ["includes", "excludes", "includesAnyOf", "includesAllOf"],
      number: ["eq", "neq", "lt", "lte", "gt", "gte", "between"],
      date: ["before", "onOrBefore", "after", "onOrAfter", "between"],
    });
  });

  it("lists every operator the Condition schema admits for each response type, and no other", () => {
    const admitted = operatorsTheSchemaAdmits(Condition);
    for (const type of RESPONSE_TYPES) {
      expect([...OPERATORS_BY_TYPE[type]].sort(), type).toEqual([...(admitted[type] ?? [])].sort());
    }
  });
});

describe("conditionsOf", () => {
  it.each<[string, Predicate | null, number]>([
    ["no predicate", null, 0],
    ["an all group", { all: [conditions.text(true), conditions.single("is", "yes")] }, 2],
    ["an any group", { any: [conditions.num("gt", 3)] }, 1],
    ["an empty group", { any: [] }, 0],
  ])("reads the conditions of %s", (_, predicate, count) => {
    const read = conditionsOf(predicate);
    expect(read).toHaveLength(count);
    if (predicate !== null) expect(read).toBe("all" in predicate ? predicate.all : predicate.any);
  });
});

describe("referencedOptionIds", () => {
  it("names the option a single-option condition compares against, and every option a list condition does", () => {
    expect(referencedOptionIds(conditions.single("isNot", "b"))).toEqual(["b"]);
    expect(referencedOptionIds(conditions.multi("includes", "a"))).toEqual(["a"]);
    expect(referencedOptionIds(conditions.singleList("isAnyOf", ["a", "c"]))).toEqual(["a", "c"]);
    expect(referencedOptionIds(conditions.multiList("includesAllOf", ["b", "c"]))).toEqual(["b", "c"]);
  });

  it("names no option for a text, number or date condition", () => {
    expect(referencedOptionIds(conditions.text(false))).toEqual([]);
    expect(referencedOptionIds(conditions.num("gte", 1))).toEqual([]);
    expect(referencedOptionIds(conditions.date("before", "2026-01-01"))).toEqual([]);
  });
});
