export interface DatabaseError {
  readonly code: string;
  readonly constraint: string | undefined;
}

const MAX_CAUSE_DEPTH = 8;

export function databaseErrorOf(error: unknown): DatabaseError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === "object" && current !== null; depth++) {
    const { code, constraint, cause } = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      return { code, constraint: typeof constraint === "string" ? constraint : undefined };
    }
    current = cause;
  }
  return undefined;
}
