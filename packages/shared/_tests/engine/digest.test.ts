import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ClientAnswers, ResponseRow } from "../../src/domain/answer.js";
import { intakeDefinition } from "../../src/demo/intake.js";
import { validateSubmission } from "../../src/engine/answer-validation.js";
import { canonicalResponseRows, responseDigest } from "../../src/engine/digest.js";
import { aDefinition, anItem, questionIdFor, questions } from "./fixtures.js";

const DATES = { today: "2026-09-13", toleranceDays: 1 };

const rows: ResponseRow[] = [
  { itemId: "itm_01", questionId: questionIdFor("itm_01"), questionVersion: 1, type: "single_choice", optionIds: ["yes"] },
  {
    itemId: "itm_02",
    questionId: questionIdFor("itm_02"),
    questionVersion: 3,
    type: "multiple_choice",
    optionIds: ["opt_hyperten", "opt_diabetes", "other"],
    otherText: "Asthma",
  },
  { itemId: "itm_03", questionId: questionIdFor("itm_03"), questionVersion: 1, type: "date", date: "2019-04-02" },
  { itemId: "itm_04", questionId: questionIdFor("itm_04"), questionVersion: 1, type: "text", text: 'Boots, "High" St | 2' },
  { itemId: "itm_05", questionId: questionIdFor("itm_05"), questionVersion: 2, type: "number", number: "72.50", unit: "kg" },
];

function reversedKeys<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("canonicalResponseRows — the four rules of [[7-application-boundary]] §5.4", () => {
  it("is exactly the documented form: sorted by itemId, optionIds sorted, decimal strings, absent fields omitted", () => {
    expect(canonicalResponseRows([...rows].reverse())).toBe(
      JSON.stringify([
        { itemId: "itm_01", type: "single_choice", optionIds: ["yes"] },
        { itemId: "itm_02", type: "multiple_choice", optionIds: ["opt_diabetes", "opt_hyperten", "other"], otherText: "Asthma" },
        { itemId: "itm_03", type: "date", date: "2019-04-02" },
        { itemId: "itm_04", type: "text", text: 'Boots, "High" St | 2' },
        { itemId: "itm_05", type: "number", number: "72.50", unit: "kg" },
      ]),
    );
  });

  it("orders keys by the canonical form, not by the order a row's properties were written", () => {
    expect(canonicalResponseRows(rows.map(reversedKeys))).toBe(canonicalResponseRows(rows));
  });
});

describe("responseDigest", () => {
  it("is SHA-256 over the canonical form, 32 bytes", async () => {
    const digest = await responseDigest(rows);
    expect(digest).toHaveLength(32);
    expect(hex(digest)).toBe(createHash("sha256").update(canonicalResponseRows(rows)).digest("hex"));
  });

  it("is deterministic under key reordering, row reordering and option click order", async () => {
    const shuffled = [rows[3]!, rows[0]!, rows[4]!, rows[2]!, rows[1]!].map(reversedKeys);
    const reclicked = shuffled.map((row) => (row.type === "multiple_choice" ? { ...row, optionIds: [...row.optionIds].reverse() } : row));
    expect(hex(await responseDigest(reclicked))).toBe(hex(await responseDigest(rows)));
  });

  it("is a pure function of the persisted rows: a JSON round-trip of the stored columns digests identically", async () => {
    const readBack = JSON.parse(JSON.stringify(rows.map(reversedKeys))) as ResponseRow[];
    expect(hex(await responseDigest(readBack))).toBe(hex(await responseDigest(rows)));
  });

  it.each<[string, (row: ResponseRow[]) => void]>([
    ["a different option", (r) => ((r[0] as { optionIds: string[] }).optionIds = ["no"])],
    ["a different otherText", (r) => ((r[1] as { otherText: string }).otherText = "Asthma ")],
    ["a different date", (r) => ((r[2] as { date: string }).date = "2019-04-03")],
    ["a different text", (r) => ((r[3] as { text: string }).text = "Boots")],
    ["a different decimal string for the same value", (r) => ((r[4] as { number: string }).number = "72.5")],
    ["a different unit", (r) => ((r[4] as { unit: string }).unit = "lb")],
    ["an extra answer", (r) => r.push({ itemId: "itm_06", questionId: questionIdFor("itm_06"), questionVersion: 1, type: "text", text: "x" })],
    ["a missing answer", (r) => r.pop()],
  ])("changes with %s", async (_, mutate) => {
    const changed = structuredClone(rows);
    mutate(changed);
    expect(hex(await responseDigest(changed))).not.toBe(hex(await responseDigest(rows)));
  });
});

describe("the digest across the submit pipeline", () => {
  const definition = intakeDefinition(1);

  async function digestOf(answers: ClientAnswers): Promise<string> {
    const result = validateSubmission(definition, answers, DATES);
    if (!result.valid) throw new Error("fixture answers should be valid");
    return hex(await responseDigest(result.rows));
  }

  it("treats an explicit null and an omitted optional answer as the same submission", async () => {
    const optional = aDefinition([anItem("itm_a", questions.text(), { required: true }), anItem("itm_b", questions.text())]);
    const digest = async (answers: ClientAnswers) => {
      const result = validateSubmission(optional, answers, DATES);
      return result.valid ? hex(await responseDigest(result.rows)) : "invalid";
    };
    expect(await digest({ itm_a: { type: "text", text: "x" }, itm_b: null })).toBe(await digest({ itm_a: { type: "text", text: "x" } }));
  });

  it("does not depend on the key order of the submitted body", async () => {
    const body: ClientAnswers = {
      itm_01: { type: "single_choice", optionId: "yes" },
      itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" },
      itm_03: { type: "date", date: "2019-04-02" },
      itm_04: { type: "text", text: "Boots" },
    };
    const reserialized = JSON.parse(JSON.stringify(reversedKeys(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v && reversedKeys(v)]))))) as ClientAnswers;
    expect(await digestOf(reserialized)).toBe(await digestOf(body));
  });

  it("normalizes -0 to the 0 Postgres numeric stores, so the digest recomputed from the stored row matches", async () => {
    const counted = aDefinition([anItem("itm_count", questions.number({ numberKind: "integer" }), { required: true })]);
    const result = validateSubmission(counted, { itm_count: { type: "number", value: "-0" } }, DATES);
    const stored: ResponseRow[] = [{ itemId: "itm_count", questionId: questionIdFor("itm_count"), questionVersion: 1, type: "number", number: "0" }];
    expect(result.valid && hex(await responseDigest(result.rows))).toBe(hex(await responseDigest(stored)));
  });
});
