import type { ResponseRow } from "../domain/answer.js";

interface ValueColumns {
  text?: string;
  number?: string;
  unit?: string;
  date?: string;
  optionIds?: readonly string[];
  otherText?: string;
}

interface WebCryptoGlobals {
  crypto: { subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(input: string): Uint8Array };
}

function byItemId(a: ResponseRow, b: ResponseRow): number {
  if (a.itemId === b.itemId) return 0;
  return a.itemId < b.itemId ? -1 : 1;
}

function canonicalRow(row: ResponseRow) {
  const values: ValueColumns = row;
  return {
    itemId: row.itemId,
    type: row.type,
    text: values.text,
    number: values.number,
    unit: values.unit,
    date: values.date,
    optionIds: values.optionIds === undefined ? undefined : [...values.optionIds].sort(),
    otherText: values.otherText,
  };
}

export function canonicalResponseRows(rows: readonly ResponseRow[]): string {
  return JSON.stringify([...rows].sort(byItemId).map(canonicalRow));
}

export async function responseDigest(rows: readonly ResponseRow[]): Promise<Uint8Array> {
  const { crypto, TextEncoder } = globalThis as unknown as WebCryptoGlobals;
  const bytes = new TextEncoder().encode(canonicalResponseRows(rows));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
