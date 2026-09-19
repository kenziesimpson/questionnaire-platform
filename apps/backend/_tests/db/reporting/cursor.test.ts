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
  ])("reads %s as no cursor", (_, raw) => {
    expect(decodeCursor(raw)).toBeUndefined();
  });
});
