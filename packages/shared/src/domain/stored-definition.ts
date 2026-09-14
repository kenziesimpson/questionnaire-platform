import { Value } from "typebox/value";
import { FORMAT_VERSION, PublishedDefinition } from "./definition.js";

type FormatUpgrade = (stored: unknown) => unknown;

const UPGRADES_FROM_FORMAT: ReadonlyMap<number, FormatUpgrade> = new Map<number, FormatUpgrade>();

const UNSUPPORTED_SNAPSHOT = "stored snapshot is not a PublishedDefinition in a supported format";

function inCurrentFormat(stored: unknown, formatVersion: number): unknown {
  if (formatVersion === FORMAT_VERSION) {
    return stored;
  }
  const upgrade = UPGRADES_FROM_FORMAT.get(formatVersion);
  if (upgrade === undefined) {
    throw new Error(UNSUPPORTED_SNAPSHOT);
  }
  return inCurrentFormat(upgrade(stored), formatVersion + 1);
}

export function readStoredDefinition(stored: unknown, formatVersion: number): PublishedDefinition {
  const current = inCurrentFormat(stored, formatVersion);
  if (Value.Check(PublishedDefinition, current)) {
    return current;
  }
  throw new Error(UNSUPPORTED_SNAPSHOT);
}
