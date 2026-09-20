import { DRAFT_ITEM_CODES, problemSlug, QUESTION_RULE_CODES, SUBMISSION_ITEM_CODES, type Problem } from "@qp/shared";
import type { TelemetryContext } from "./fields.js";

export const SCHEMA_CODES = [
  "schema/required",
  "schema/type",
  "schema/additionalProperties",
  "schema/enum",
  "schema/const",
  "schema/minimum",
  "schema/maximum",
  "schema/exclusiveMinimum",
  "schema/exclusiveMaximum",
  "schema/multipleOf",
  "schema/minLength",
  "schema/maxLength",
  "schema/pattern",
  "schema/format",
  "schema/minItems",
  "schema/maxItems",
  "schema/uniqueItems",
  "schema/minProperties",
  "schema/maxProperties",
  "schema/anyOf",
  "schema/oneOf",
  "schema/other",
] as const;

export const PROBLEM_CODES = [...QUESTION_RULE_CODES, ...DRAFT_ITEM_CODES, ...SUBMISSION_ITEM_CODES, ...SCHEMA_CODES] as const;
type ProblemCode = (typeof PROBLEM_CODES)[number];

export const MAX_FINDINGS = 20;

export interface FindingTotals {
  readonly findingCount: number;
  readonly omittedCount: number;
}

export function findingTotals(findingCount: number): FindingTotals {
  return { findingCount, omittedCount: Math.max(0, findingCount - MAX_FINDINGS) };
}

export function tallyCodes<C extends string>(codes: readonly C[]): ReadonlyMap<C, number> {
  const tally = new Map<C, number>();
  for (const code of codes) tally.set(code, (tally.get(code) ?? 0) + 1);
  return tally;
}

function knownCode(code: string): ProblemCode | undefined {
  return PROBLEM_CODES.find((known) => known === code) ?? (code.startsWith("schema/") ? "schema/other" : undefined);
}

function itemFinding(outcome: TelemetryContext, item: { readonly itemId: string; readonly code: string }): TelemetryContext {
  return { ...outcome, problemCode: knownCode(item.code), ...(item.code === "answer/unknown-item" ? {} : { itemId: item.itemId }) };
}

export function projectProblem(body: Problem): readonly TelemetryContext[] {
  const outcome: TelemetryContext = { problem: problemSlug(body.type), status: body.status };
  const findings: TelemetryContext[] =
    "items" in body
      ? body.items.map((item) => itemFinding(outcome, item))
      : "errors" in body
        ? body.errors.map((error) => ({ ...outcome, problemCode: knownCode(error.code) }))
        : [];
  return findings.length === 0 ? [outcome] : findings.slice(0, MAX_FINDINGS);
}
