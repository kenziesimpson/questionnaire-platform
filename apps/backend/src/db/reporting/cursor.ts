export interface SessionCursor {
  readonly direction: "older" | "newer";
  readonly startedAt: Date;
  readonly id: string;
}

const FIELD_SEPARATOR = "|";
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (startedAtIso === undefined || id === undefined) return undefined;
  if (!CANONICAL_INSTANT.test(startedAtIso) || !UUID.test(id)) return undefined;
  const startedAt = new Date(startedAtIso);
  if (Number.isNaN(startedAt.getTime()) || startedAt.toISOString() !== startedAtIso) return undefined;
  return { direction, startedAt, id };
}
