import { and, asc, desc, gt, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { session } from "../schema.js";
import type { CursorDirection, SessionCursor, SessionOrdering } from "./cursor.js";

function sortColumn({ sort }: SessionOrdering): PgColumn {
  return sort === "started" ? session.startedAt : session.submittedAt;
}

function isNullable({ sort }: SessionOrdering): boolean {
  return sort === "submitted";
}

function scansAscending({ order }: SessionOrdering, direction: CursorDirection): boolean {
  return (order === "asc") === (direction === "forward");
}

function ascendingNullsFirst(column: PgColumn): SQL {
  // eslint-disable-next-line no-restricted-syntax -- the query builder's asc() cannot place NULLs, and the placement has to match the index for Postgres to scan it instead of sorting
  return sql`${column} asc nulls first`;
}

function ascendingNullsLast(column: PgColumn): SQL {
  // eslint-disable-next-line no-restricted-syntax -- the query builder's asc() cannot place NULLs, and the placement has to match the index for Postgres to scan it instead of sorting
  return sql`${column} asc nulls last`;
}

function descendingNullsFirst(column: PgColumn): SQL {
  // eslint-disable-next-line no-restricted-syntax -- the query builder's desc() cannot place NULLs, and the placement has to match the index for Postgres to scan it instead of sorting
  return sql`${column} desc nulls first`;
}

function descendingNullsLast(column: PgColumn): SQL {
  // eslint-disable-next-line no-restricted-syntax -- the query builder's desc() cannot place NULLs, and the placement has to match the index for Postgres to scan it instead of sorting
  return sql`${column} desc nulls last`;
}

function nullableOrder(column: PgColumn, ascending: boolean, nullsFirst: boolean): SQL {
  if (ascending) return nullsFirst ? ascendingNullsFirst(column) : ascendingNullsLast(column);
  return nullsFirst ? descendingNullsFirst(column) : descendingNullsLast(column);
}

export function orderByFor(ordering: SessionOrdering, direction: CursorDirection): SQL[] {
  const column = sortColumn(ordering);
  const ascending = scansAscending(ordering, direction);
  const primary = isNullable(ordering)
    ? nullableOrder(column, ascending, direction === "backward")
    : ascending
      ? asc(column)
      : desc(column);
  return [primary, ascending ? asc(session.id) : desc(session.id)];
}

function rowAfterAscending(column: PgColumn, at: string, id: string): SQL {
  // eslint-disable-next-line no-restricted-syntax -- the row-value comparison is what lets Postgres seek the (questionnaire_id, sort column, id) index to the cursor; the query builder can only express the OR form, which the index cannot seek
  return sql`(${column}, ${session.id}) > (${at}::timestamptz, ${id}::uuid)`;
}

function rowAfterDescending(column: PgColumn, at: string, id: string): SQL {
  // eslint-disable-next-line no-restricted-syntax -- the row-value comparison is what lets Postgres seek the (questionnaire_id, sort column, id) index to the cursor; the query builder can only express the OR form, which the index cannot seek
  return sql`(${column}, ${session.id}) < (${at}::timestamptz, ${id}::uuid)`;
}

function rowAfter(column: PgColumn, ascending: boolean, sortValue: Date, id: string): SQL {
  const at = sortValue.toISOString();
  return ascending ? rowAfterAscending(column, at, id) : rowAfterDescending(column, at, id);
}

export function keysetSegments(ordering: SessionOrdering, cursor: SessionCursor | undefined): (SQL | undefined)[] {
  if (cursor === undefined) return [undefined];
  const column = sortColumn(ordering);
  const ascending = scansAscending(ordering, cursor.direction);
  if (cursor.sortValue !== null) {
    const valued = rowAfter(column, ascending, cursor.sortValue, cursor.id);
    return cursor.direction === "forward" && isNullable(ordering) ? [valued, isNull(column)] : [valued];
  }
  const nullsAfterId = and(isNull(column), ascending ? gt(session.id, cursor.id) : lt(session.id, cursor.id));
  return cursor.direction === "backward" ? [nullsAfterId, isNotNull(column)] : [nullsAfterId];
}
