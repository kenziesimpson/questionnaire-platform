import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scrubContext } from "@qp/telemetry";
import { describe, expect, it } from "vitest";
import { InvariantViolation } from "../src/invariant.js";
import { SESSION_ID } from "./http/fixtures.js";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src/", import.meta.url));

const INVARIANT_CALL = /(?<!function )\b(InvariantViolation\.of|mustExist|requireValue)\(/g;

const NAME_ARGUMENT_INDEX: Record<string, number> = { "InvariantViolation.of": 0, mustExist: 1, requireValue: 1 };

function argumentsOf(source: string, open: number): string[] {
  const found: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = open;
  for (let at = open; at < source.length; at++) {
    const char = source.charAt(at);
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(" || char === "[" || char === "{") {
      depth++;
    } else if (char === ")" || char === "]" || char === "}") {
      depth--;
      if (depth < 0) {
        found.push(source.slice(start, at).trim());
        return found;
      }
    } else if (char === "," && depth === 0) {
      found.push(source.slice(start, at).trim());
      start = at + 1;
    }
  }
  return found;
}

async function invariantNamesInSources(): Promise<{ readonly names: string[]; readonly notLiterals: string[] }> {
  const files = (await readdir(SOURCE_DIRECTORY, { recursive: true })).filter((file) => file.endsWith(".ts"));
  const names: string[] = [];
  const notLiterals: string[] = [];
  for (const file of files) {
    const source = await readFile(`${SOURCE_DIRECTORY}${file}`, "utf8");
    for (const call of source.matchAll(INVARIANT_CALL)) {
      const argument = argumentsOf(source, call.index + call[0].length)[NAME_ARGUMENT_INDEX[call[1] ?? ""] ?? 0];
      if (argument === "invariant") continue;
      const literal = /^"([^"]+)"$/.exec(argument ?? "")?.[1];
      if (literal === undefined) notLiterals.push(`${file}: ${call[1]}(${argument})`);
      else names.push(literal);
    }
  }
  return { names, notLiterals };
}

describe("every invariant name in src", () => {
  it("is a string literal the telemetry registry accepts as an invariant field", async () => {
    const { names, notLiterals } = await invariantNamesInSources();

    expect(notLiterals).toEqual([]);
    expect(names.length).toBeGreaterThan(25);
    const rejected = names.filter((name) => scrubContext({ invariant: name }).dropped.invalid > 0);
    expect(rejected).toEqual([]);
  });
});

describe("InvariantViolation", () => {
  it("carries its literal name and the ids it was given, and is an Error named for its class", () => {
    const violation = InvariantViolation.of("session.not-marked-submitted", { sessionId: SESSION_ID, questionnaireVersion: 2 });

    expect(violation).toBeInstanceOf(Error);
    expect(violation.name).toBe("InvariantViolation");
    expect(violation.invariant).toBe("session.not-marked-submitted");
    expect(violation.ids).toEqual({ sessionId: SESSION_ID, questionnaireVersion: 2 });
    expect(violation.message).toBe("session.not-marked-submitted");
  });

  it("has no ids unless it is given some", () => {
    expect(InvariantViolation.of("author.read-outside-author-hook").ids).toEqual({});
  });

  it("refuses a name built at runtime and a field that is not an id", () => {
    const value = "CANARY_DIABETES_8F3A" as string;
    // @ts-expect-error — an interpolated name is a pattern type, not a literal
    InvariantViolation.of(`row ${value} is missing`);
    // @ts-expect-error — nor is a name held in a `string` variable
    InvariantViolation.of(value);
    // @ts-expect-error — only the id fields are accepted
    InvariantViolation.of("session.not-marked-submitted", { status: 500 });
    // @ts-expect-error — the constructor is private
    expect(() => new InvariantViolation(value, {})).not.toThrow();
  });
});
