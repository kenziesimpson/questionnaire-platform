import {
  evaluateVisibility,
  responseDigest,
  serverDateContext,
  validateSubmission,
  type ClientAnswers,
  type ItemError,
  type PublishedDefinition,
  type Receipt,
  type ResponseRow,
  type ResponseType,
  type Sensitive,
  type SubmissionItemCode,
} from "@qp/shared";
import { withSpan } from "@qp/telemetry";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { InvariantViolation } from "../../invariant.js";
import type { Database, Transaction } from "../client.js";
import { questionnaire, response, session } from "../schema.js";
import type { PublishedDefinitions } from "./published-definitions.js";
import { isClosed, receiptFor, sessionColumns, type SessionRow } from "./sessions.js";

export interface SubmitCommand {
  readonly sessionId: string;
  readonly answers: Sensitive<ClientAnswers>;
  readonly now: Date;
}

export interface SessionFacts {
  readonly sessionId: string;
  readonly questionnaireId: string;
  readonly questionnaireVersion: number;
}

interface AnsweredItem {
  readonly itemId: string;
  readonly questionId: string;
  readonly questionType: ResponseType;
}

interface SkippedItem {
  readonly itemId: string;
  readonly questionId: string;
}

interface Rejection {
  readonly itemId: string | null;
  readonly questionId: string | null;
  readonly code: SubmissionItemCode;
}

export type SubmitOutcome =
  | {
      readonly outcome: "submitted";
      readonly receipt: Receipt;
      readonly facts: SessionFacts;
      readonly durationMs: number;
      readonly answered: readonly AnsweredItem[];
      readonly skipped: readonly SkippedItem[];
    }
  | { readonly outcome: "replayed"; readonly receipt: Receipt; readonly facts: SessionFacts }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "closed"; readonly facts: SessionFacts }
  | { readonly outcome: "already-submitted"; readonly facts: SessionFacts }
  | {
      readonly outcome: "invalid";
      readonly items: readonly ItemError<SubmissionItemCode>[];
      readonly facts: SessionFacts;
      readonly rejections: readonly Rejection[];
    };

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

function factsOf(row: SessionRow): SessionFacts {
  return { sessionId: row.id, questionnaireId: row.questionnaireId, questionnaireVersion: row.version };
}

function evaluateAnswers(row: SessionRow, definition: PublishedDefinition, answers: Sensitive<ClientAnswers>, at: Date) {
  return withSpan("rule.evaluate", factsOf(row), async () => {
    const supplied = answers.unwrap();
    return {
      validation: validateSubmission(definition, supplied, serverDateContext(at)),
      shown: evaluateVisibility(definition, supplied),
    };
  });
}

function rejectionsOf(definition: PublishedDefinition, items: readonly ItemError<SubmissionItemCode>[]): Rejection[] {
  const questionIds = new Map(definition.items.map((item) => [item.itemId, item.question.questionId]));
  return items.map(({ itemId, code }) => {
    const questionId = questionIds.get(itemId);
    return questionId === undefined ? { itemId: null, questionId: null, code } : { itemId, questionId, code };
  });
}

function skippedItemsOf(definition: PublishedDefinition, shown: ReadonlySet<string>): SkippedItem[] {
  return definition.items
    .filter((item) => !shown.has(item.itemId))
    .map((item) => ({ itemId: item.itemId, questionId: item.question.questionId }));
}

function answeredItemsOf(rows: readonly ResponseRow[]): AnsweredItem[] {
  return rows.map((row) => ({ itemId: row.itemId, questionId: row.questionId, questionType: row.type }));
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
    throw InvariantViolation.of("session.not-marked-submitted", { sessionId });
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

    const facts = factsOf(locked);

    if (locked.submittedAt !== null && locked.responseDigest !== null) {
      const { validation: retry } = await evaluateAnswers(locked, definition, command.answers, locked.submittedAt);
      const sameAnswers = retry.valid && Buffer.from(await responseDigest(retry.rows)).equals(locked.responseDigest);
      return sameAnswers
        ? { outcome: "replayed", receipt: receiptFor(locked, locked.submittedAt), facts }
        : { outcome: "already-submitted", facts };
    }

    if (isClosed(await closesAtOf(tx, locked.questionnaireId), command.now)) {
      return { outcome: "closed", facts };
    }

    const { validation, shown } = await evaluateAnswers(locked, definition, command.answers, command.now);
    if (!validation.valid) {
      return { outcome: "invalid", items: validation.items, facts, rejections: rejectionsOf(definition, validation.items) };
    }

    await persistResponses(tx, locked, validation.rows, command.now);
    await markSubmitted(tx, locked.id, await responseDigest(validation.rows), command.now);
    return {
      outcome: "submitted",
      receipt: receiptFor(locked, command.now),
      facts,
      durationMs: Math.max(0, command.now.getTime() - locked.startedAt.getTime()),
      answered: answeredItemsOf(validation.rows),
      skipped: skippedItemsOf(definition, shown),
    };
  });
}
