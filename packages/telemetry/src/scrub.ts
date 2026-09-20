import { definitionOfAttribute, FIELDS, isFieldName } from "./fields.js";
import { DROP_REASONS, type DropReason, type SignalKind } from "./vocabulary.js";

export type ScrubbedAttributes = Readonly<Record<string, string | number | boolean>>;

export type DropCounts = Readonly<Record<DropReason, number>>;

export interface ScrubResult {
  readonly attributes: ScrubbedAttributes;
  readonly dropped: DropCounts;
}

const UNEXPORTED_SPAN_ATTRIBUTES: ReadonlySet<string> = new Set(["db.query.text"]);

export const NO_DROPS: DropCounts = { unknown: 0, invalid: 0, unbounded: 0, internal: 0 };

export function oneDropped(reason: DropReason): DropCounts {
  return { ...NO_DROPS, [reason]: 1 };
}

export function totalDropped(dropped: DropCounts): number {
  return DROP_REASONS.reduce((total, reason) => total + dropped[reason], 0);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function entriesOf(input: unknown): [string, unknown][] {
  return typeof input === "object" && input !== null ? Object.entries(input) : [];
}

function failedScrub(): ScrubResult {
  return { attributes: {}, dropped: oneDropped("internal") };
}

function scrubbedContext(context: unknown): ScrubResult {
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

function scrubbedAttributes(input: unknown, kind: SignalKind): ScrubResult {
  const attributes: Record<string, string | number | boolean> = {};
  const dropped = { ...NO_DROPS };
  for (const [key, value] of entriesOf(input)) {
    if (value === undefined || value === null) continue;
    if (kind === "span" && UNEXPORTED_SPAN_ATTRIBUTES.has(key)) continue;
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

export function scrubContext(context: unknown): ScrubResult {
  try {
    return scrubbedContext(context);
  } catch {
    return failedScrub();
  }
}

export function scrubAttributes(input: unknown, kind: SignalKind): ScrubResult {
  try {
    return scrubbedAttributes(input, kind);
  } catch {
    return failedScrub();
  }
}
