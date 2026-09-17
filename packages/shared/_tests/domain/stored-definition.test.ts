import { describe, expect, it } from "vitest";
import { intakeDefinition } from "../../src/demo/intake.js";
import { FORMAT_VERSION, type PublishedDefinition } from "../../src/domain/definition.js";
import { readStoredDefinition } from "../../src/domain/stored-definition.js";
import type { Equal } from "../type-equality.js";

const UNSUPPORTED_SNAPSHOT = "stored snapshot is not a PublishedDefinition in a supported format";

function storedCopyOf(definition: PublishedDefinition): unknown {
  return JSON.parse(JSON.stringify(definition));
}

describe("readStoredDefinition", () => {
  it.each([1, 2] as const)("returns intake v%i stored in the current format as the PublishedDefinition it holds", (version) => {
    expect(readStoredDefinition(storedCopyOf(intakeDefinition(version)), FORMAT_VERSION)).toEqual(intakeDefinition(version));
  });

  it.each([
    ["a blank title", { ...intakeDefinition(1), title: "" }],
    ["a field the format does not have", { ...intakeDefinition(1), publishedBy: "prototype-author" }],
    ["a document naming formatVersion 2", { ...intakeDefinition(1), formatVersion: 2 }],
    ["an item without a question", { ...intakeDefinition(1), items: [{ itemId: "itm_01", required: true, visibleWhen: null }] }],
    ["an empty object", {}],
    ["a JSON string", JSON.stringify(intakeDefinition(1))],
    ["null", null],
  ])("refuses %s stored as the current format", (_, stored) => {
    expect(() => readStoredDefinition(stored, FORMAT_VERSION)).toThrow(new Error(UNSUPPORTED_SNAPSHOT));
  });

  it.each([
    ["a future format", FORMAT_VERSION + 1],
    ["a format before the first", 0],
    ["a negative format", -1],
    ["a fractional format", FORMAT_VERSION + 0.5],
  ])("refuses a valid document stored under %s, which no upgrade reaches", (_, formatVersion) => {
    expect(() => readStoredDefinition(storedCopyOf(intakeDefinition(1)), formatVersion)).toThrow(new Error(UNSUPPORTED_SNAPSHOT));
  });

  it("types its result as exactly PublishedDefinition", () => {
    const exact: [Equal<ReturnType<typeof readStoredDefinition>, PublishedDefinition>] = [true];

    expect(exact).not.toContain(false);
  });
});
