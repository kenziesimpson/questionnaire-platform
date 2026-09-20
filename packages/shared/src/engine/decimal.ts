import { DECIMAL_PATTERN } from "../primitives.js";

const DECIMAL = new RegExp(DECIMAL_PATTERN);
const EXPONENT_FORM = /^(-?)([0-9]+)(?:\.([0-9]+))?e([+-][0-9]+)$/;

interface DecimalParts {
  negative: boolean;
  integer: string;
  fraction: string;
}

function decimalParts(decimal: string): DecimalParts | undefined {
  const match = DECIMAL.exec(decimal);
  if (!match) return undefined;
  const integer = match[1];
  if (integer === undefined) throw new Error(`DECIMAL_PATTERN matched without its mandatory integer group: ${decimal}`);
  const fraction = (match[2] ?? "").slice(1).replace(/0+$/, "");
  const isZero = integer === "0" && fraction === "";
  return { negative: decimal.startsWith("-") && !isZero, integer, fraction };
}

function compareMagnitudes(a: DecimalParts, b: DecimalParts): number {
  if (a.integer.length !== b.integer.length) return Math.sign(a.integer.length - b.integer.length);
  if (a.integer !== b.integer) return a.integer < b.integer ? -1 : 1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const fractionA = a.fraction.padEnd(width, "0");
  const fractionB = b.fraction.padEnd(width, "0");
  if (fractionA === fractionB) return 0;
  return fractionA < fractionB ? -1 : 1;
}

export function decimalFromNumber(value: number): string {
  const shortest = String(value);
  const match = EXPONENT_FORM.exec(shortest);
  if (!match) return shortest;
  const sign = match[1];
  const whole = match[2];
  if (sign === undefined || whole === undefined) {
    throw new Error(`EXPONENT_FORM matched without its mandatory sign or whole-number group: ${shortest}`);
  }
  const digits = whole + (match[3] ?? "");
  const pointAt = whole.length + Number(match[4]);
  if (pointAt <= 0) return `${sign}0.${"0".repeat(-pointAt)}${digits}`;
  if (pointAt >= digits.length) return `${sign}${digits}${"0".repeat(pointAt - digits.length)}`;
  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
}

export function compareDecimals(a: string, b: string): number | undefined {
  const partsA = decimalParts(a);
  const partsB = decimalParts(b);
  if (!partsA || !partsB) return undefined;
  if (partsA.negative !== partsB.negative) return partsA.negative ? -1 : 1;
  const magnitude = compareMagnitudes(partsA, partsB);
  return partsA.negative ? -magnitude : magnitude;
}

export function compareDecimalToNumber(decimal: string, value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return compareDecimals(decimal, decimalFromNumber(value));
}

export function canonicalDecimal(decimal: string): string | undefined {
  const parts = decimalParts(decimal);
  if (!parts) return undefined;
  const sign = parts.negative ? "-" : "";
  return parts.fraction === "" ? `${sign}${parts.integer}` : `${sign}${parts.integer}.${parts.fraction}`;
}

export function isIntegerDecimal(decimal: string): boolean {
  const canonical = canonicalDecimal(decimal);
  return canonical !== undefined && !canonical.includes(".");
}
