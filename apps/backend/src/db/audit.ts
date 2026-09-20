import { sql } from "drizzle-orm";
import { InvariantViolation } from "../invariant.js";
import type { Transaction } from "./client.js";
import type { AUDIT_ACTIONS } from "./schema.js";

type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditTraceId = string | null | undefined;

export interface AuditEntry {
  readonly action: AuditAction;
  readonly questionnaireId: string | null;
  readonly questionnaireVersionId: string | null;
  readonly version: number | null;
  readonly actorId: string | null;
  readonly summary: Record<string, unknown> | null;
  readonly traceId: AuditTraceId;
}

export async function recordAudit(tx: Transaction, entry: AuditEntry): Promise<string> {
  const summary = entry.summary === null ? null : JSON.stringify(entry.summary);
  const result = await tx.execute<{ id: string }>(
    // eslint-disable-next-line no-restricted-syntax -- audit.record is the SECURITY DEFINER function that is the only write path into audit.event (Decisions Log #24); the query builder cannot call a Postgres function
    sql`SELECT audit.record(
          ${entry.action}::text,
          ${entry.questionnaireId}::uuid,
          ${entry.questionnaireVersionId}::uuid,
          ${entry.version}::int,
          ${entry.actorId}::text,
          ${summary}::jsonb,
          ${entry.traceId ?? null}::text
        ) AS id`,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw InvariantViolation.of("audit.record-returned-no-id", {
      questionnaireId: entry.questionnaireId,
      questionnaireVersion: entry.version,
    });
  }
  return row.id;
}
