import { sql } from "drizzle-orm";
import { InvariantViolation } from "../../invariant.js";
import type { Transaction } from "../client.js";

export type ResponseViewTraceId = string | null | undefined;

interface ResponseView {
  readonly questionnaireId: string;
  readonly questionnaireVersionId: string;
  readonly version: number;
  readonly sessionId: string;
  readonly actorId: string;
  readonly traceId: ResponseViewTraceId;
}

export async function recordResponseView(tx: Transaction, view: ResponseView): Promise<string> {
  const result = await tx.execute<{ id: string }>(
    // eslint-disable-next-line no-restricted-syntax -- audit.record is the SECURITY DEFINER function that is the only write path into audit.event (Decisions Log #24); the query builder cannot call a Postgres function
    sql`SELECT audit.record(
          'view_response'::text,
          ${view.questionnaireId}::uuid,
          ${view.questionnaireVersionId}::uuid,
          ${view.version}::int,
          ${view.actorId}::text,
          jsonb_build_object('sessionId', ${view.sessionId}::uuid),
          ${view.traceId ?? null}::text
        ) AS id`,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw InvariantViolation.of("audit.view-response-returned-no-id", {
      questionnaireId: view.questionnaireId,
      questionnaireVersion: view.version,
      sessionId: view.sessionId,
    });
  }
  return row.id;
}
