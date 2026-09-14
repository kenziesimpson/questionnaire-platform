import { problemSlug, SUBMISSION_ITEM_CODES, type Problem, type ProblemDetailsWire } from "@qp/shared";
import { CODES_WITHOUT_A_RENDERED_ITEM, type RenderedItemErrorCode } from "./messages";

export type ProblemBody = Problem | ProblemDetailsWire;

export type RenderedItemErrors = Readonly<Partial<Record<string, readonly RenderedItemErrorCode[]>>>;

const renderedItemErrorCodes = new Set<string>(SUBMISSION_ITEM_CODES);
for (const code of CODES_WITHOUT_A_RENDERED_ITEM) renderedItemErrorCodes.delete(code);

function isRenderedItemErrorCode(code: string): code is RenderedItemErrorCode {
  return renderedItemErrorCodes.has(code);
}

export function errorsByItemId(body: ProblemBody): RenderedItemErrors {
  if (problemSlug(body.type) !== "submission/invalid" || !("items" in body)) return {};
  const grouped = new Map<string, RenderedItemErrorCode[]>();
  for (const { itemId, code } of body.items ?? []) {
    if (!isRenderedItemErrorCode(code)) continue;
    const codes = grouped.get(itemId);
    if (codes === undefined) grouped.set(itemId, [code]);
    else codes.push(code);
  }
  return Object.fromEntries(grouped);
}
