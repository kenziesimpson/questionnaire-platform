import {
  responseDigest,
  serverDateContext,
  validateSubmission,
  type ClientAnswers,
  type ItemError,
  type Receipt,
  type ResponseRow,
  type Sensitive,
  type SubmissionItemCode,
} from "@qp/shared";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Database, Transaction } from "../client.js";
import { questionnaire, response, session } from "../schema.js";
import type { PublishedDefinitions } from "./published-definitions.js";
import { isClosed, receiptFor, sessionColumns, type SessionRow } from "./sessions.js";

export interface SubmitCommand {
  readonly sessionId: string;
  readonly answers: Sensitive<ClientAnswers>;
  readonly now: Date;
}

export type SubmitOutcome =
  | { readonly outcome: "submitted"; readonly receipt: Receipt }
  | { readonly outcome: "replayed"; readonly receipt: Receipt }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "closed" }
  | { readonly outcome: "already-submitted" }
  | { readonly outcome: "invalid"; readonly items: readonly ItemError<SubmissionItemCode>[] };

type ValueColumns = Pick<
  typeof response.$inferInsert,
  "textValue" | "numberValue" | "numberUnit" | "dateValue" | "optionIds" | "otherText"
>;

function valueColumns(row: ResponseRow): ValueColumns {
  switch (row.type) {
    case "text":
      return { textValue: row.text };
    case "number":
      return { numberValue: row.number, numberUnit: row.unit ?? null };
    case "date":
      return { dateValue: row.date };
    case "single_choice":
    case "multiple_choice":
      return { optionIds: [...row.optionIds], otherText: row.otherText ?? null };
  }
}

async function lockSession(tx: Transaction, sessionId: string) {
  const [locked] = await tx
    .select({ ...sessionColumns, responseDigest: session.responseDigest })
    .from(session)
    .where(eq(session.id, sessionId))
    .for("update");
  return locked;
}

async function closesAtOf(tx: Transaction, questionnaireId: string): Promise<Date | null> {
  const [row] = await tx
    .select({ closesAt: questionnaire.closesAt })
    .from(questionnaire)
    .where(eq(questionnaire.id, questionnaireId));
  return row?.closesAt ?? null;
}

async function persistResponses(tx: Transaction, locked: SessionRow, rows: readonly ResponseRow[], submittedAt: Date) {
  if (rows.length > 0) {
    await tx.insert(response).values(
      rows.map((row) => ({
        id: uuidv7(),
        createdAt: submittedAt,
        sessionId: locked.id,
        questionnaireVersionId: locked.questionnaireVersionId,
        itemId: row.itemId,
        questionId: row.questionId,
        questionVersion: row.questionVersion,
        questionType: row.type,
        ...valueColumns(row),
      })),
    );
  }
}

async function markSubmitted(tx: Transaction, sessionId: string, digest: Uint8Array, submittedAt: Date) {
  const updated = await tx
    .update(session)
    .set({ status: "submitted", submittedAt, lastActivityAt: submittedAt, responseDigest: Buffer.from(digest) })
    .where(and(eq(session.id, sessionId), eq(session.status, "in_progress")))
    .returning({ id: session.id });
  if (updated.length !== 1) {
    throw new Error("a locked in-progress session could not be marked submitted");
  }
}

export async function submitSession(
  database: Database,
  definitions: PublishedDefinitions,
  command: SubmitCommand,
): Promise<SubmitOutcome> {
  return database.transaction(async (tx) => {
    const locked = await lockSession(tx, command.sessionId);
    if (locked === undefined) {
      return { outcome: "not-found" };
    }
    const definition = await definitions.pinned(tx, locked.questionnaireVersionId);

    if (locked.submittedAt !== null && locked.responseDigest !== null) {
      const retry = validateSubmission(definition, command.answers.unwrap(), serverDateContext(locked.submittedAt));
      const sameAnswers = retry.valid && Buffer.from(await responseDigest(retry.rows)).equals(locked.responseDigest);
      return sameAnswers
        ? { outcome: "replayed", receipt: receiptFor(locked, locked.submittedAt) }
        : { outcome: "already-submitted" };
    }

    if (isClosed(await closesAtOf(tx, locked.questionnaireId), command.now)) {
      return { outcome: "closed" };
    }

    const validation = validateSubmission(definition, command.answers.unwrap(), serverDateContext(command.now));
    if (!validation.valid) {
      return { outcome: "invalid", items: validation.items };
    }

    await persistResponses(tx, locked, validation.rows, command.now);
    await markSubmitted(tx, locked.id, await responseDigest(validation.rows), command.now);
    return { outcome: "submitted", receipt: receiptFor(locked, command.now) };
  });
}
