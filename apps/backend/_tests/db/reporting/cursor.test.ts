import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, type SessionCursor, type SessionOrdering } from "../../../src/db/reporting/cursor.js";

const STARTED_DESC: SessionOrdering = { sort: "started", order: "desc" };
const SUBMITTED_ASC: SessionOrdering = { sort: "submitted", order: "asc" };
const ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c1";
const INSTANT = "2026-09-10T09:03:04.567Z";

const cursor: SessionCursor = {
  ...STARTED_DESC,
  direction: "forward",
  sortValue: new Date(INSTANT),
  id: ID,
};

function encoded(fields: string): string {
  return Buffer.from(fields, "utf8").toString("base64url");
}

describe("session cursors", () => {
  it.each(["forward", "backward"] as const)("round-trips a %s cursor, keeping the millisecond of the sort value", (direction) => {
    const decoded = decodeCursor(encodeCursor({ ...cursor, direction }), STARTED_DESC);

    expect(decoded).toEqual({ ...cursor, direction });
    expect(decoded?.sortValue?.getTime()).toBe(cursor.sortValue?.getTime());
  });

  it.each([
    ["started", "asc"],
    ["started", "desc"],
    ["submitted", "asc"],
    ["submitted", "desc"],
  ] as const)("round-trips a cursor issued for %s %s", (sort, order) => {
    const issued: SessionCursor = { ...cursor, sort, order };

    expect(decodeCursor(encodeCursor(issued), { sort, order })).toEqual(issued);
  });

  it("round-trips the null marker, which only an in-progress session under sort=submitted can anchor", () => {
    const anchoredOnNull: SessionCursor = { ...SUBMITTED_ASC, direction: "forward", sortValue: null, id: ID };

    expect(decodeCursor(encodeCursor(anchoredOnNull), SUBMITTED_ASC)).toEqual(anchoredOnNull);
  });

  it("encodes to a url-safe token, so it can sit in a query string unescaped", () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not expose the position as readable text in the query string", () => {
    expect(encodeCursor(cursor)).not.toContain(ID);
  });

  it("fits the 128 characters the wire schema allows, in the longest form the server issues", () => {
    const longest: SessionCursor = { sort: "submitted", order: "desc", direction: "backward", sortValue: new Date(INSTANT), id: ID };

    expect(encodeCursor(longest).length).toBeLessThanOrEqual(128);
  });

  it.each([
    ["an empty string", ""],
    ["text that is not an encoded cursor", "not-a-cursor"],
    ["too few fields", encoded(`forward|started|desc|${INSTANT}`)],
    ["the four fields of the previous cursor format", encoded(`forward|${INSTANT}|${ID}`)],
    ["too many fields", encoded(`forward|started|desc|${INSTANT}|${ID}|extra`)],
    ["a direction that is neither forward nor backward", encoded(`sideways|started|desc|${INSTANT}|${ID}`)],
    ["the retired older direction", encoded(`older|started|desc|${INSTANT}|${ID}`)],
    ["a sort that is not a column", encoded(`forward|id|desc|${INSTANT}|${ID}`)],
    ["a sort carrying SQL", encoded(`forward|started; DROP TABLE execution.session|desc|${INSTANT}|${ID}`)],
    ["an order that is neither asc nor desc", encoded(`forward|started|sideways|${INSTANT}|${ID}`)],
    ["an order carrying SQL", encoded(`forward|started|desc, id|${INSTANT}|${ID}`)],
    ["a sort value that is not a date", encoded(`forward|started|desc|yesterday|${ID}`)],
    ["an empty sort value", encoded(`forward|started|desc||${ID}`)],
    ["an empty id", encoded(`forward|started|desc|${INSTANT}|`)],
    ["an id that is not a uuid", encoded(`forward|started|desc|${INSTANT}|not-a-uuid`)],
    ["an id carrying SQL", encoded(`forward|started|desc|${INSTANT}|' OR 1=1 --`)],
    ["a sort value that is not in the canonical form", encoded(`forward|started|desc|2026-09-10|${ID}`)],
    ["a sort value with an extended year", encoded(`forward|started|desc|+275760-09-13T00:00:00.000Z|${ID}`)],
    ["a sort value that names a day that does not exist", encoded(`forward|started|desc|2026-02-31T00:00:00.000Z|${ID}`)],
    ["a sort value with an offset instead of Z", encoded(`forward|started|desc|2026-09-10T09:03:04.567+00:00|${ID}`)],
    ["the null marker under sort=started, where the column is never null", encoded(`forward|started|desc|null|${ID}`)],
    ["the null marker in any casing but its own", encoded(`forward|submitted|desc|NULL|${ID}`)],
  ])("reads %s as no cursor", (_, raw) => {
    expect(decodeCursor(raw, STARTED_DESC)).toBeUndefined();
    expect(decodeCursor(raw, { sort: "submitted", order: "desc" })).toBeUndefined();
  });

  describe("a cursor issued for a different ordering", () => {
    const issuedForSubmittedAsc = encodeCursor({ ...SUBMITTED_ASC, direction: "forward", sortValue: new Date(INSTANT), id: ID });

    it("is accepted under the ordering it was issued for", () => {
      expect(decodeCursor(issuedForSubmittedAsc, SUBMITTED_ASC)).toBeDefined();
    });

    it.each([
      ["another sort column", { sort: "started", order: "asc" }],
      ["the opposite order", { sort: "submitted", order: "desc" }],
      ["the default ordering", STARTED_DESC],
    ] as const)("reads as no cursor under %s", (_, expected) => {
      expect(decodeCursor(issuedForSubmittedAsc, expected)).toBeUndefined();
    });
  });
});
