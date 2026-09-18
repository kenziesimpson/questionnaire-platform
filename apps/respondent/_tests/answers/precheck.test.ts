import { describe, expect, it } from "vitest";
import { browserTimeZone } from "../../src/answers/precheck.ts";

describe("browserTimeZone", () => {
  it("reads the resolved Intl time zone", () => {
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
