import { describe, expect, it } from "vitest";
import { withDatabase, withRole } from "./server.js";

describe("withRole", () => {
  it.each(["plain", "p@ss/w:rd", "100%sure", "a b#?&=+", "ümlaut"])(
    "encodes %s exactly once, so decoding the URL gives the password back",
    (password) => {
      const url = new URL(withDatabase(withRole("postgres://admin:secret@localhost:5432/postgres", "qp_owner", password), "qp_test_1"));

      expect(decodeURIComponent(url.username)).toBe("qp_owner");
      expect(decodeURIComponent(url.password)).toBe(password);
      expect(url.pathname).toBe("/qp_test_1");
    },
  );
});
