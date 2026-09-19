import type { SessionSort, SortOrder } from "@qp/shared";

export type CursorDirection = "forward" | "backward";

export interface SessionOrdering {
  readonly sort: SessionSort;
  readonly order: SortOrder;
}

export interface SessionCursor extends SessionOrdering {
  readonly direction: CursorDirection;
  readonly sortValue: Date | null;
  readonly id: string;
}

const FIELD_SEPARATOR = "|";
const NULL_SORT_VALUE = "null";
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: SessionCursor): string {
  const sortValue = cursor.sortValue === null ? NULL_SORT_VALUE : cursor.sortValue.toISOString();
  const encoded = [cursor.direction, cursor.sort, cursor.order, sortValue, cursor.id].join(FIELD_SEPARATOR);
  return Buffer.from(encoded, "utf8").toString("base64url");
}

function isDirection(value: string | undefined): value is CursorDirection {
  return value === "forward" || value === "backward";
}

function isSort(value: string | undefined): value is SessionSort {
  return value === "started" || value === "submitted";
}

function isOrder(value: string | undefined): value is SortOrder {
  return value === "asc" || value === "desc";
}

function decodeSortValue(raw: string, sort: SessionSort): Date | null | undefined {
  if (raw === NULL_SORT_VALUE) return sort === "submitted" ? null : undefined;
  if (!CANONICAL_INSTANT.test(raw)) return undefined;
  const instant = new Date(raw);
  return Number.isNaN(instant.getTime()) || instant.toISOString() !== raw ? undefined : instant;
}

export function decodeCursor(raw: string, expected: SessionOrdering): SessionCursor | undefined {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
  const parts = decoded.split(FIELD_SEPARATOR);
  if (parts.length !== 5) return undefined;
  const [direction, sort, order, rawSortValue, id] = parts;
  if (!isDirection(direction) || !isSort(sort) || !isOrder(order)) return undefined;
  if (sort !== expected.sort || order !== expected.order) return undefined;
  if (rawSortValue === undefined || id === undefined || !UUID.test(id)) return undefined;
  const sortValue = decodeSortValue(rawSortValue, sort);
  return sortValue === undefined ? undefined : { direction, sort, order, sortValue, id };
}
