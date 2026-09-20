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

export interface CappedFindings<T, C extends string> {
  readonly logged: readonly T[];
  readonly totals: FindingTotals;
  readonly perCode: ReadonlyMap<C, number>;
}

export function capFindings<T, C extends string>(findings: readonly T[], codeOf: (finding: T) => C): CappedFindings<T, C> {
  const logged = findings.slice(0, MAX_FINDINGS);
  const perCode = new Map<C, number>();
  for (const finding of findings) {
    const code = codeOf(finding);
    perCode.set(code, (perCode.get(code) ?? 0) + 1);
  }
  return { logged, totals: { findingCount: findings.length, omittedCount: findings.length - logged.length }, perCode };
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
