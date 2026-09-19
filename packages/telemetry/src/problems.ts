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

const MAX_FINDINGS = 20;

function knownCode(code: string): ProblemCode {
  return PROBLEM_CODES.find((known) => known === code) ?? "schema/other";
}

export function problemTelemetry(body: Problem): readonly TelemetryContext[] {
  const outcome: TelemetryContext = { problem: problemSlug(body.type), status: body.status };
  const findings: TelemetryContext[] =
    "items" in body
      ? body.items.map((item) => ({ ...outcome, itemId: item.itemId, problemCode: knownCode(item.code) }))
      : "errors" in body
        ? body.errors.map((error) => ({ ...outcome, problemCode: knownCode(error.code) }))
        : [];
  return findings.length === 0 ? [outcome] : findings.slice(0, MAX_FINDINGS);
}
