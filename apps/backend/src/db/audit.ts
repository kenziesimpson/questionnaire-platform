import { sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import type { AUDIT_ACTIONS } from "./schema.js";

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  readonly action: AuditAction;
  readonly questionnaireId: string | null;
  readonly questionnaireVersionId: string | null;
  readonly version: number | null;
  readonly actorId: string | null;
  readonly summary: Record<string, unknown> | null;
  readonly traceId: string | null;
}

export async function recordAudit(tx: Transaction, entry: AuditEntry): Promise<string> {
  const summary = entry.summary === null ? null : JSON.stringify(entry.summary);
  const result = await tx.execute<{ id: string }>(
    sql`SELECT audit.record(
          ${entry.action}::text,
          ${entry.questionnaireId}::uuid,
          ${entry.questionnaireVersionId}::uuid,
          ${entry.version}::int,
          ${entry.actorId}::text,
          ${summary}::jsonb,
          ${entry.traceId}::text
        ) AS id`,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("audit.record returned no id");
  }
  return row.id;
}
