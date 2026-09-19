export interface SessionCursor {
  readonly direction: "older" | "newer";
  readonly startedAt: Date;
  readonly id: string;
}

const FIELD_SEPARATOR = "|";

export function encodeCursor(cursor: SessionCursor): string {
  const encoded = [cursor.direction, cursor.startedAt.toISOString(), cursor.id].join(FIELD_SEPARATOR);
  return Buffer.from(encoded, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): SessionCursor | undefined {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
  const parts = decoded.split(FIELD_SEPARATOR);
  if (parts.length !== 3) return undefined;
  const [direction, startedAtIso, id] = parts;
  if (direction !== "older" && direction !== "newer") return undefined;
  if (startedAtIso === undefined || id === undefined || id === "") return undefined;
  const startedAt = new Date(startedAtIso);
  if (Number.isNaN(startedAt.getTime())) return undefined;
  return { direction, startedAt, id };
}
