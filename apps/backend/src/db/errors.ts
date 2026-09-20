import { FIELDS, type LiteralMessage } from "@qp/telemetry";
import { InvariantViolation, type InvariantIds } from "../invariant.js";

export const SQLSTATE = {
  immutable: "QP001",
  insufficientPrivilege: "42501",
  checkViolation: "23514",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
  noPartitionForRow: "23514",
} as const;

export const QUESTION_VERSION_PRIMARY_KEY = "question_version_pkey";

export interface DatabaseError {
  readonly code: string;
  readonly constraint: string | undefined;
}

const MAX_CAUSE_DEPTH = 8;

export function databaseErrorOf(error: unknown): DatabaseError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === "object" && current !== null; depth++) {
    const { code, constraint, cause } = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof code === "string" && FIELDS.errorCode.accepts(code)) {
      return { code, constraint: typeof constraint === "string" ? constraint : undefined };
    }
    current = cause;
  }
  return undefined;
}

export function mustExist<Value, N extends string>(value: Value | null | undefined, invariant: LiteralMessage<N>, ids: InvariantIds = {}): Value {
  if (value === null || value === undefined) {
    throw InvariantViolation.of(invariant, ids);
  }
  return value;
}
