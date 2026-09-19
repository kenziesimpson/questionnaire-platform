import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, type SessionCursor } from "../../../src/db/reporting/cursor.js";

const cursor: SessionCursor = {
  direction: "older",
  startedAt: new Date("2026-09-10T09:03:04.567Z"),
  id: "01a0950e-56a0-73d6-b936-4a1e10eff8c1",
};

function encoded(fields: string): string {
  return Buffer.from(fields, "utf8").toString("base64url");
}

describe("session cursors", () => {
  it.each(["older", "newer"] as const)("round-trips a %s cursor, keeping the millisecond of startedAt", (direction) => {
    const decoded = decodeCursor(encodeCursor({ ...cursor, direction }));

    expect(decoded).toEqual({ ...cursor, direction });
    expect(decoded?.startedAt.getTime()).toBe(cursor.startedAt.getTime());
  });

  it("encodes to a url-safe token, so it can sit in a query string unescaped", () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not expose the position as readable text in the query string", () => {
    expect(encodeCursor(cursor)).not.toContain(cursor.id);
  });

  it.each([
    ["an empty string", ""],
    ["text that is not an encoded cursor", "not-a-cursor"],
    ["too few fields", encoded("older|2026-09-10T09:03:04.567Z")],
    ["too many fields", encoded(`older|2026-09-10T09:03:04.567Z|${cursor.id}|extra`)],
    ["a direction that is neither older nor newer", encoded(`sideways|2026-09-10T09:03:04.567Z|${cursor.id}`)],
    ["a startedAt that is not a date", encoded(`older|yesterday|${cursor.id}`)],
    ["an empty startedAt", encoded(`older||${cursor.id}`)],
    ["an empty id", encoded("older|2026-09-10T09:03:04.567Z|")],
    ["an id that is not a uuid", encoded("older|2026-09-10T09:03:04.567Z|not-a-uuid")],
    ["an id carrying SQL", encoded("older|2026-09-10T09:03:04.567Z|' OR 1=1 --")],
    ["a startedAt that is not in the canonical form", encoded(`older|2026-09-10|${cursor.id}`)],
    ["a startedAt with an extended year", encoded(`older|+275760-09-13T00:00:00.000Z|${cursor.id}`)],
    ["a startedAt that names a day that does not exist", encoded(`older|2026-02-31T00:00:00.000Z|${cursor.id}`)],
  ])("reads %s as no cursor", (_, raw) => {
    expect(decodeCursor(raw)).toBeUndefined();
  });
});
