import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function syntaxMessages(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

const TO_LOCALE_DATE_STRING = `export const label = new Date().toLocaleDateString();`;
const TO_LOCALE_STRING = `export const label = new Date().toLocaleString();`;
const INTL_DATE_TIME_FORMAT = `export const formatter = new Intl.DateTimeFormat("en-GB");`;

const SCREEN = "apps/admin/src/screens/version-history.tsx";
const LIB = "apps/admin/src/lib/counts.ts";
const DATES_HOME = "apps/admin/src/lib/dates.ts";

describe("L21: dates are formatted only in admin's src/lib/dates.ts", () => {
  it.each([
    ["toLocaleDateString", TO_LOCALE_DATE_STRING],
    ["toLocaleString", TO_LOCALE_STRING],
    ["Intl.DateTimeFormat", INTL_DATE_TIME_FORMAT],
  ])("rejects %s elsewhere in admin's src", async (_, code) => {
    expect(await syntaxMessages(SCREEN, code)).toHaveLength(1);
    expect(await syntaxMessages(LIB, code)).toHaveLength(1);
  });

  it.each([
    ["toLocaleDateString", TO_LOCALE_DATE_STRING],
    ["toLocaleString", TO_LOCALE_STRING],
    ["Intl.DateTimeFormat", INTL_DATE_TIME_FORMAT],
  ])("allows %s inside src/lib/dates.ts", async (_, code) => {
    expect(await syntaxMessages(DATES_HOME, code)).toEqual([]);
  });

  it("leaves manual date-part math, which is not banned, alone", async () => {
    const code = `export const twoDigits = (value: number) => String(value).padStart(2, "0");`;
    expect(await syntaxMessages(SCREEN, code)).toEqual([]);
  });

  it("still keeps the inherited problem-parsing restriction in admin's src", async () => {
    const code = `Value.Check(ProblemDetails, body);`;
    expect(await syntaxMessages(SCREEN, code)).toHaveLength(1);
  });
});
