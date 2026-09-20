import { Value } from "typebox/value";
import { FORMAT_VERSION, PublishedDefinition } from "./definition.js";

type FormatUpgrade = (stored: unknown) => unknown;

const UPGRADES_FROM_FORMAT: ReadonlyMap<number, FormatUpgrade> = new Map<number, FormatUpgrade>();

const UNSUPPORTED_SNAPSHOT = "stored snapshot is not a PublishedDefinition in a supported format";

export class UnsupportedSnapshotError extends Error {
  constructor() {
    super(UNSUPPORTED_SNAPSHOT);
    this.name = "UnsupportedSnapshotError";
  }
}

function inCurrentFormat(stored: unknown, formatVersion: number): unknown {
  if (formatVersion === FORMAT_VERSION) {
    return stored;
  }
  const upgrade = UPGRADES_FROM_FORMAT.get(formatVersion);
  if (upgrade === undefined) {
    throw new UnsupportedSnapshotError();
  }
  return inCurrentFormat(upgrade(stored), formatVersion + 1);
}

export function readStoredDefinition(stored: unknown, formatVersion: number): PublishedDefinition {
  const current = inCurrentFormat(stored, formatVersion);
  if (Value.Check(PublishedDefinition, current)) {
    return current;
  }
  throw new UnsupportedSnapshotError();
}
