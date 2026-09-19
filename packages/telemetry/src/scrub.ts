import { definitionOfAttribute, FIELDS, isFieldName } from "./fields.js";

export type SignalKind = "log" | "span" | "metric";

export type DropReason = "unknown" | "invalid" | "unbounded";

export type ScrubbedAttributes = Readonly<Record<string, string | number | boolean>>;

export type DropCounts = Readonly<Record<DropReason, number>>;

export interface ScrubResult {
  readonly attributes: ScrubbedAttributes;
  readonly dropped: DropCounts;
}

const NO_DROPS: DropCounts = { unknown: 0, invalid: 0, unbounded: 0 };

export function totalDropped(dropped: DropCounts): number {
  return dropped.unknown + dropped.invalid + dropped.unbounded;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function entriesOf(input: unknown): [string, unknown][] {
  return typeof input === "object" && input !== null ? Object.entries(input) : [];
}

export function scrubContext(context: unknown): ScrubResult {
  const attributes: Record<string, string | number | boolean> = {};
  const dropped = { ...NO_DROPS };
  for (const [key, value] of entriesOf(context)) {
    if (value === undefined || value === null) continue;
    if (!isFieldName(key)) {
      dropped.unknown += 1;
      continue;
    }
    const definition = FIELDS[key];
    if (definition.accepts(value) && isScalar(value)) {
      attributes[definition.attribute] = value;
    } else {
      dropped.invalid += 1;
    }
  }
  return { attributes, dropped };
}

export function scrubAttributes(input: unknown, kind: SignalKind): ScrubResult {
  const attributes: Record<string, string | number | boolean> = {};
  const dropped = { ...NO_DROPS };
  for (const [key, value] of entriesOf(input)) {
    if (value === undefined || value === null) continue;
    const definition = definitionOfAttribute(key);
    if (definition === undefined) {
      dropped.unknown += 1;
    } else if (!definition.accepts(value) || !isScalar(value)) {
      dropped.invalid += 1;
    } else if (kind === "metric" && !definition.bounded) {
      dropped.unbounded += 1;
    } else {
      attributes[key] = value;
    }
  }
  return { attributes, dropped };
}
