import {
  DEFAULT_SESSION_SORT,
  DEFAULT_SORT_ORDER,
  evaluateVisibility,
  RESPONSES_PAGE_SIZE,
  type ResponseRow,
  type SessionDetail,
  type SessionSort,
  type SessionStatus,
  type SessionSummary,
  type SessionSummaryPage,
  type SortOrder,
} from "@qp/shared";
import { and, eq, type SQL } from "drizzle-orm";
import type { Database, Executor } from "../client.js";
import { PublishedDefinitions } from "../execution/published-definitions.js";
import { questionnaire, session } from "../schema.js";
import { recordResponseView, type ResponseViewTraceId } from "./audit.js";
import { decodeCursor, encodeCursor, type CursorDirection, type SessionCursor, type SessionOrdering } from "./cursor.js";
import { keysetSegments, orderByFor } from "./keyset.js";
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
  readonly sort?: SessionSort;
  readonly order?: SortOrder;
  readonly cursor?: string;
}

const SNAPSHOT_READ = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;

function orderingOf(params: Pick<ListSessionsParams, "sort" | "order">): SessionOrdering {
  return {
    sort: params.sort ?? DEFAULT_SESSION_SORT,
    order: params.order ?? DEFAULT_SORT_ORDER,
  };
}

export function pageQueries(
  reporting: Executor,
  filters: readonly (SQL | undefined)[],
  ordering: SessionOrdering,
  direction: CursorDirection,
  segments: readonly (SQL | undefined)[],
) {
  const order = orderByFor(ordering, direction);
  return segments.map(
    (segment) => (limit: number) =>
      reporting
        .select(sessionColumns)
        .from(session)
        .where(and(...filters, segment))
        .orderBy(...order)
        .limit(limit),
  );
}

async function fetchPageRows(executor: Executor, queries: ReturnType<typeof pageQueries>): Promise<SessionRow[]> {
  const rows: SessionRow[] = [];
  for (const query of queries) {
    const missing = RESPONSES_PAGE_SIZE + 1 - rows.length;
    if (missing <= 0) break;
    rows.push(...(await query(missing)));
  }
  return rows;
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

function anchorOf(row: SessionRow, ordering: SessionOrdering, direction: SessionCursor["direction"]): string {
  return encodeCursor({
    ...ordering,
    direction,
    sortValue: ordering.sort === "started" ? row.startedAt : row.submittedAt,
    id: row.id,
  });
}

export async function listSessionSummaries(
  reporting: Database,
  definitions: PublishedDefinitions,
  params: ListSessionsParams,
): Promise<SessionSummaryPage> {
  const ordering = orderingOf(params);
  const cursor = params.cursor === undefined ? undefined : decodeCursor(params.cursor, ordering);
  const filters: (SQL | undefined)[] = [
    eq(session.questionnaireId, params.questionnaireId),
    params.status === undefined ? undefined : eq(session.status, params.status),
    params.version === undefined ? undefined : eq(session.version, params.version),
  ];

  const backward = cursor?.direction === "backward";
  const direction = cursor?.direction ?? "forward";
  const segments = keysetSegments(ordering, cursor, params.status);
  const rows: SessionRow[] =
    segments.length <= 1
      ? await fetchPageRows(reporting, pageQueries(reporting, filters, ordering, direction, segments))
      : await reporting.transaction((tx) => fetchPageRows(tx, pageQueries(tx, filters, ordering, direction, segments)), SNAPSHOT_READ);

  const hasExtra = rows.length > RESPONSES_PAGE_SIZE;
  const page = rows.slice(0, RESPONSES_PAGE_SIZE);
  if (backward) {
    page.reverse();
  }

  const hasMoreNext = cursor === undefined ? hasExtra : backward ? true : hasExtra;
  const hasMorePrevious = cursor !== undefined && (backward ? hasExtra : true);

  const submitted = page.flatMap((row) => submittedRef(row) ?? []);
  const responseRows = await responseRowsBySession(reporting, submitted);
  const items = await Promise.all(page.map((row) => summaryOf(definitions, reporting, row, responseRows)));

  const first = page[0];
  const last = page[page.length - 1];
  return {
    items,
    previousCursor: hasMorePrevious && first !== undefined ? anchorOf(first, ordering, "backward") : null,
    nextCursor: hasMoreNext && last !== undefined ? anchorOf(last, ordering, "forward") : null,
  };
}

export type SessionDetailOutcome = { readonly outcome: "found"; readonly detail: SessionDetail } | { readonly outcome: "not-found" };

interface DetailReader {
  readonly actorId: string;
  readonly traceId: ResponseViewTraceId;
}

async function readSessionDetail(
  reporting: Executor,
  definitions: PublishedDefinitions,
  questionnaireId: string,
  sessionId: string,
): Promise<{ readonly row: SessionRow; readonly detail: SessionDetail } | undefined> {
  const [row]: SessionRow[] = await reporting
    .select(sessionColumns)
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.questionnaireId, questionnaireId)));
  if (row === undefined) {
    return undefined;
  }

  const definition = await definitions.pinned(reporting, row.questionnaireVersionId);
  const submitted = submittedRef(row);
  const responseRows = submitted === undefined ? [] : ((await responseRowsBySession(reporting, [submitted])).get(row.id) ?? []);
  const shown = evaluateVisibility(definition, answersFromResponseRows(responseRows));
  const answerByItemId = new Map(responseRows.map((answer) => [answer.itemId, answer]));

  return {
    row,
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

export async function getSessionDetail(
  reporting: Database,
  definitions: PublishedDefinitions,
  questionnaireId: string,
  sessionId: string,
  reader: DetailReader,
): Promise<SessionDetailOutcome> {
  return reporting.transaction(async (tx): Promise<SessionDetailOutcome> => {
    const read = await readSessionDetail(tx, definitions, questionnaireId, sessionId);
    if (read === undefined) {
      return { outcome: "not-found" };
    }
    await recordResponseView(tx, {
      questionnaireId: read.row.questionnaireId,
      questionnaireVersionId: read.row.questionnaireVersionId,
      version: read.row.version,
      sessionId: read.row.id,
      actorId: reader.actorId,
      traceId: reader.traceId,
    });
    return { outcome: "found", detail: read.detail };
  });
}
