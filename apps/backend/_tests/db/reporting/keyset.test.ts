import type { SessionStatus, SortOrder } from "@qp/shared";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CursorDirection, SessionCursor, SessionOrdering } from "../../../src/db/reporting/cursor.js";
import { keysetSegments } from "../../../src/db/reporting/keyset.js";

const ID = "7f000000-0000-4000-8000-000000000000";
const INSTANT = new Date("2026-03-01T01:00:00.000Z");
const ORDERS: readonly SortOrder[] = ["asc", "desc"];
const STATUSES: readonly (SessionStatus | undefined)[] = [undefined, "submitted", "in_progress"];

type Anchor = "none" | "valued" | "null";

function cursorAt(ordering: SessionOrdering, direction: CursorDirection, anchor: Anchor): SessionCursor | undefined {
  if (anchor === "none") return undefined;
  return { ...ordering, direction, sortValue: anchor === "valued" ? INSTANT : null, id: ID };
}

function countFor(status: SessionStatus | undefined, direction: CursorDirection, anchor: Anchor): number {
  if (anchor === "none") return 1;
  if (anchor === "valued" && direction === "backward") return status === "in_progress" ? 0 : 1;
  if (anchor === "valued") return status === undefined ? 2 : 1;
  if (direction === "forward") return status === "submitted" ? 0 : 1;
  return status === undefined ? 2 : 1;
}

function rendered(segments: readonly (SQL | undefined)[]): string[] {
  const dialect = new PgDialect();
  return segments.map((segment) => (segment === undefined ? "" : dialect.sqlToQuery(segment).sql));
}

describe("keysetSegments", () => {
  const submittedCases = ORDERS.flatMap((order) =>
    STATUSES.flatMap((status) =>
      (["forward", "backward"] as const).flatMap((direction) =>
        (["none", "valued", "null"] as const).map((anchor) => [order, status, direction, anchor] as const),
      ),
    ),
  );

  it.each(submittedCases)(
    "under submitted %s with status %s, a %s cursor anchored on a %s row emits only the segments that can return a row",
    (order, status, direction, anchor) => {
      const ordering = { sort: "submitted", order } as const;

      const segments = keysetSegments(ordering, cursorAt(ordering, direction, anchor), status);

      expect(segments).toHaveLength(countFor(status, direction, anchor));
    },
  );

  it.each(ORDERS.flatMap((order) => STATUSES.map((status) => [order, status] as const)))(
    "under started %s with status %s, never drops a segment, because started_at is never null",
    (order, status) => {
      const ordering = { sort: "started", order } as const;

      for (const direction of ["forward", "backward"] as const) {
        expect(keysetSegments(ordering, cursorAt(ordering, direction, "valued"), status)).toHaveLength(1);
      }
      expect(keysetSegments(ordering, undefined, status)).toHaveLength(1);
    },
  );

  it("keeps the row comparison for submitted sessions and the null test for in-progress ones", () => {
    const ordering = { sort: "submitted", order: "asc" } as const;
    const forward = cursorAt(ordering, "forward", "valued");
    const fromTheTail = cursorAt(ordering, "backward", "null");

    expect(rendered(keysetSegments(ordering, forward, undefined))).toEqual([expect.stringMatching(/\) > \(/), expect.stringMatching(/ is null$/)]);
    expect(rendered(keysetSegments(ordering, forward, "submitted"))).toEqual([expect.stringMatching(/\) > \(/)]);
    expect(rendered(keysetSegments(ordering, forward, "in_progress"))).toEqual([expect.stringMatching(/ is null$/)]);
    expect(rendered(keysetSegments(ordering, fromTheTail, "submitted"))).toEqual([expect.stringMatching(/ is not null$/)]);
    expect(rendered(keysetSegments(ordering, fromTheTail, "in_progress"))).toEqual([expect.stringMatching(/ is null and /)]);
  });

  it("changes nothing without a status filter: the first page is one unfiltered statement", () => {
    const ordering = { sort: "submitted", order: "desc" } as const;

    expect(keysetSegments(ordering, undefined, undefined)).toEqual([undefined]);
  });
});
