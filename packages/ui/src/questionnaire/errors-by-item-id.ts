import { problemSlug, type Problem, type ProblemDetailsWire } from "@qp/shared";
import { isRenderedItemErrorCode, type RenderedItemErrorCode } from "./messages";
import type { ItemErrors } from "./types";

export type ProblemBody = Problem | ProblemDetailsWire;

export function errorsByItemId(body: ProblemBody): ItemErrors {
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
