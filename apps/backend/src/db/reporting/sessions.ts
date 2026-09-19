import {
  evaluateVisibility,
  RESPONSES_PAGE_SIZE,
  type ResponseRow,
  type SessionDetail,
  type SessionStatus,
  type SessionSummary,
  type SessionSummaryPage,
} from "@qp/shared";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Executor } from "../client.js";
import { PublishedDefinitions } from "../execution/published-definitions.js";
import { questionnaire, session } from "../schema.js";
import { decodeCursor, encodeCursor, type SessionCursor } from "./cursor.js";
import { answersFromResponseRows, responseRowsBySession, type SubmittedSessionRef } from "./responses.js";

const sessionColumns = {
  id: session.id,
  questionnaireId: session.questionnaireId,
  questionnaireVersionId: session.questionnaireVersionId,
  version: session.version,
  status: session.status,
  startedAt: session.startedAt,
  submittedAt: session.submittedAt,
};

interface SessionRow {
  readonly id: string;
  readonly questionnaireId: string;
  readonly questionnaireVersionId: string;
  readonly version: number;
  readonly status: SessionStatus;
  readonly startedAt: Date;
  readonly submittedAt: Date | null;
}

function submittedRef(row: SessionRow): SubmittedSessionRef | undefined {
  return row.status === "submitted" && row.submittedAt !== null ? { id: row.id, submittedAt: row.submittedAt } : undefined;
}

export async function questionnaireExistsForReporting(reporting: Executor, questionnaireId: string): Promise<boolean> {
  const [row] = await reporting.select({ id: questionnaire.id }).from(questionnaire).where(eq(questionnaire.id, questionnaireId));
  return row !== undefined;
}

export interface ListSessionsParams {
  readonly questionnaireId: string;
  readonly status?: SessionStatus;
  readonly version?: number;
  readonly cursor?: string;
}

function keysetCondition(cursor: SessionCursor): SQL {
  const operator = cursor.direction === "older" ? "<" : ">";
  // eslint-disable-next-line no-restricted-syntax -- the row-value comparison is what lets Postgres seek session_by_questionnaire (questionnaire_id, started_at, id) to the cursor; the query builder can only express the OR form, which the index cannot seek
  return sql`(${session.startedAt}, ${session.id}) ${sql.raw(operator)} (${cursor.startedAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
}

async function summaryOf(
  definitions: PublishedDefinitions,
  reporting: Executor,
  row: SessionRow,
  responseRows: ReadonlyMap<string, ResponseRow[]>,
): Promise<SessionSummary> {
  const definition = await definitions.pinned(reporting, row.questionnaireVersionId);
  const itemCount = definition.items.length;
  const startedAt = row.startedAt.toISOString();
  if (row.status !== "submitted") {
    return {
      sessionId: row.id,
      questionnaireId: row.questionnaireId,
      version: row.version,
      status: row.status,
      startedAt,
      submittedAt: null,
      itemCount,
      answeredCount: 0,
      hiddenCount: 0,
    };
  }
  const rows = responseRows.get(row.id) ?? [];
  const shown = evaluateVisibility(definition, answersFromResponseRows(rows));
  return {
    sessionId: row.id,
    questionnaireId: row.questionnaireId,
    version: row.version,
    status: row.status,
    startedAt,
    submittedAt: row.submittedAt === null ? null : row.submittedAt.toISOString(),
    itemCount,
    answeredCount: rows.length,
    hiddenCount: itemCount - shown.size,
  };
}

export async function listSessionSummaries(
  reporting: Executor,
  definitions: PublishedDefinitions,
  params: ListSessionsParams,
): Promise<SessionSummaryPage> {
  const cursor = params.cursor === undefined ? undefined : decodeCursor(params.cursor);
  const filters: (SQL | undefined)[] = [
    eq(session.questionnaireId, params.questionnaireId),
    params.status === undefined ? undefined : eq(session.status, params.status),
    params.version === undefined ? undefined : eq(session.version, params.version),
    cursor === undefined ? undefined : keysetCondition(cursor),
  ];

  const ascending = cursor?.direction === "newer";
  const rows: SessionRow[] = await reporting
    .select(sessionColumns)
    .from(session)
    .where(and(...filters))
    .orderBy(ascending ? asc(session.startedAt) : desc(session.startedAt), ascending ? asc(session.id) : desc(session.id))
    .limit(RESPONSES_PAGE_SIZE + 1);

  const hasExtra = rows.length > RESPONSES_PAGE_SIZE;
  const page = rows.slice(0, RESPONSES_PAGE_SIZE);
  if (ascending) {
    page.reverse();
  }

  const hasMoreOlder = cursor === undefined ? hasExtra : cursor.direction === "older" ? hasExtra : true;
  const hasMoreNewer = cursor !== undefined && (cursor.direction === "newer" ? hasExtra : true);

  const submitted = page.flatMap((row) => submittedRef(row) ?? []);
  const responseRows = await responseRowsBySession(reporting, submitted);
  const items = await Promise.all(page.map((row) => summaryOf(definitions, reporting, row, responseRows)));

  const first = page[0];
  const last = page[page.length - 1];
  return {
    items,
    olderCursor: hasMoreOlder && last !== undefined ? encodeCursor({ direction: "older", startedAt: last.startedAt, id: last.id }) : null,
    newerCursor: hasMoreNewer && first !== undefined ? encodeCursor({ direction: "newer", startedAt: first.startedAt, id: first.id }) : null,
  };
}

export type SessionDetailOutcome = { readonly outcome: "found"; readonly detail: SessionDetail } | { readonly outcome: "not-found" };

export async function getSessionDetail(
  reporting: Executor,
  definitions: PublishedDefinitions,
  questionnaireId: string,
  sessionId: string,
): Promise<SessionDetailOutcome> {
  const [row]: SessionRow[] = await reporting
    .select(sessionColumns)
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.questionnaireId, questionnaireId)));
  if (row === undefined) {
    return { outcome: "not-found" };
  }

  const definition = await definitions.pinned(reporting, row.questionnaireVersionId);
  const submitted = submittedRef(row);
  const responseRows = submitted === undefined ? [] : (await responseRowsBySession(reporting, [submitted])).get(row.id) ?? [];
  const shown = evaluateVisibility(definition, answersFromResponseRows(responseRows));
  const answerByItemId = new Map(responseRows.map((answer) => [answer.itemId, answer]));

  return {
    outcome: "found",
    detail: {
      sessionId: row.id,
      questionnaireId: row.questionnaireId,
      questionnaireTitle: definition.title,
      version: row.version,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      submittedAt: row.submittedAt === null ? null : row.submittedAt.toISOString(),
      items: definition.items.map((item) => ({
        itemId: item.itemId,
        required: item.required,
        visibleWhen: item.visibleWhen,
        question: item.question,
        visible: shown.has(item.itemId),
        answer: answerByItemId.get(item.itemId) ?? null,
      })),
    },
  };
}
