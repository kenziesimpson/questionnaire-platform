import type { Question, QuestionInput, QuestionUsage, QuestionVersion, QuestionVersionSummary } from "@qp/shared";
import { and, asc, desc, eq, gt, isNotNull, isNull, notExists, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit.js";
import type { Executor, Transaction } from "../client.js";
import { question, questionnaireVersion, questionVersion, questionVersionOption, versionQuestionIndex } from "../schema.js";
import { questionInputToColumns, storedQuestionToVersion, type StoredOption } from "./question-content.js";

export interface CreateQuestionCommand {
  readonly questionId?: string;
  readonly key: string | null;
  readonly content: QuestionInput;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export interface SavedQuestionVersion {
  readonly questionId: string;
  readonly questionVersion: number;
}

async function insertQuestionVersion(
  tx: Transaction,
  questionId: string,
  version: number,
  content: QuestionInput,
  createdBy: string | null,
  traceId: string | null,
): Promise<SavedQuestionVersion> {
  const columns = questionInputToColumns(content);
  await tx.insert(questionVersion).values({
    questionId,
    version,
    type: columns.type,
    prompt: columns.prompt,
    constraints: columns.constraints,
    createdBy,
  });
  if (columns.options.length > 0) {
    await tx.insert(questionVersionOption).values(
      columns.options.map((option, position) => ({
        questionId,
        version,
        optionId: option.optionId,
        label: option.label,
        position,
        freeform: option.freeform ?? false,
      })),
    );
  }
  await recordAudit(tx, {
    action: "create_question_version",
    questionnaireId: null,
    questionnaireVersionId: null,
    version: null,
    actorId: createdBy,
    summary: { questionId, questionVersion: version },
    traceId,
  });
  return { questionId, questionVersion: version };
}

export async function createQuestion(executor: Executor, command: CreateQuestionCommand): Promise<SavedQuestionVersion> {
  return executor.transaction(async (tx) => {
    const questionId = command.questionId ?? uuidv7();
    await tx.insert(question).values({ id: questionId, key: command.key });
    return insertQuestionVersion(tx, questionId, 1, command.content, command.createdBy, command.traceId);
  });
}

export interface AppendQuestionVersionCommand {
  readonly questionId: string;
  readonly content: QuestionInput;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export type AppendQuestionVersionOutcome =
  | ({ readonly outcome: "saved" } & SavedQuestionVersion)
  | { readonly outcome: "not-found" };

export async function appendQuestionVersion(
  executor: Executor,
  command: AppendQuestionVersionCommand,
): Promise<AppendQuestionVersionOutcome> {
  return executor.transaction(async (tx) => {
    const locked = await tx
      .select({ id: question.id })
      .from(question)
      .where(eq(question.id, command.questionId))
      .for("update");
    if (locked.length === 0) {
      return { outcome: "not-found" };
    }
    const [latest] = await tx
      .select({ next: sql<number>`coalesce(max(${questionVersion.version}), 0) + 1` })
      .from(questionVersion)
      .where(eq(questionVersion.questionId, command.questionId));
    const saved = await insertQuestionVersion(
      tx,
      command.questionId,
      Number(latest?.next ?? 1),
      command.content,
      command.createdBy,
      command.traceId,
    );
    return { outcome: "saved", ...saved };
  });
}

const newerVersion = alias(questionVersion, "newer_version");

function questionVersionColumns(executor: Executor) {
  const optionsInPosition = executor
    .select({
      options: sql`json_agg(
        json_build_object(
          'optionId', ${questionVersionOption.optionId},
          'label', ${questionVersionOption.label},
          'freeform', ${questionVersionOption.freeform})
        ORDER BY ${questionVersionOption.position})`,
    })
    .from(questionVersionOption)
    .where(
      and(
        eq(questionVersionOption.questionId, questionVersion.questionId),
        eq(questionVersionOption.version, questionVersion.version),
      ),
    );

  return {
    questionId: questionVersion.questionId,
    version: questionVersion.version,
    type: questionVersion.type,
    prompt: questionVersion.prompt,
    constraints: questionVersion.constraints,
    createdAt: questionVersion.createdAt,
    createdBy: questionVersion.createdBy,
    options: sql<StoredOption[]>`coalesce((${optionsInPosition}), '[]'::json)`,
  };
}

async function readLatestQuestions(executor: Executor, filter: SQL | undefined): Promise<Question[]> {
  const isLatestVersion = notExists(
    executor
      .select({ one: sql`1` })
      .from(newerVersion)
      .where(and(eq(newerVersion.questionId, questionVersion.questionId), gt(newerVersion.version, questionVersion.version))),
  );

  const rows = await executor
    .select({
      key: question.key,
      archivedAt: question.archivedAt,
      questionCreatedAt: question.createdAt,
      latest: questionVersionColumns(executor),
    })
    .from(question)
    .innerJoin(questionVersion, eq(questionVersion.questionId, question.id))
    .where(and(isLatestVersion, filter))
    .orderBy(desc(question.id));

  return rows.map((row) => ({
    questionId: row.latest.questionId,
    key: row.key,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.questionCreatedAt.toISOString(),
    latest: storedQuestionToVersion(row.latest, row.latest.options),
  }));
}

export interface ListQuestionsQuery {
  readonly includeArchived: boolean;
}

export async function listQuestions(executor: Executor, query: ListQuestionsQuery): Promise<Question[]> {
  return readLatestQuestions(executor, query.includeArchived ? undefined : isNull(question.archivedAt));
}

export async function findQuestion(executor: Executor, questionId: string): Promise<Question | undefined> {
  const [found] = await readLatestQuestions(executor, eq(question.id, questionId));
  return found;
}

async function questionExists(executor: Executor, questionId: string): Promise<boolean> {
  const rows = await executor.select({ id: question.id }).from(question).where(eq(question.id, questionId));
  return rows.length === 1;
}

export async function listQuestionVersionSummaries(
  executor: Executor,
  questionId: string,
): Promise<QuestionVersionSummary[] | undefined> {
  const rows = await executor
    .select({
      questionVersion: questionVersion.version,
      type: questionVersion.type,
      createdAt: questionVersion.createdAt,
      createdBy: questionVersion.createdBy,
    })
    .from(questionVersion)
    .where(eq(questionVersion.questionId, questionId))
    .orderBy(desc(questionVersion.version));
  if (rows.length === 0 && !(await questionExists(executor, questionId))) {
    return undefined;
  }
  return rows.map((row) => ({
    ...row,
    type: row.type as QuestionVersionSummary["type"],
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function findQuestionVersion(
  executor: Executor,
  questionId: string,
  version: number,
): Promise<QuestionVersion | undefined> {
  const [row] = await executor
    .select(questionVersionColumns(executor))
    .from(questionVersion)
    .where(and(eq(questionVersion.questionId, questionId), eq(questionVersion.version, version)));
  return row === undefined ? undefined : storedQuestionToVersion(row, row.options);
}

export async function listQuestionUsage(executor: Executor, questionId: string): Promise<QuestionUsage[] | undefined> {
  if (!(await questionExists(executor, questionId))) {
    return undefined;
  }
  const rows = await executor
    .select({
      questionnaireId: questionnaireVersion.questionnaireId,
      version: questionnaireVersion.version,
      questionVersion: versionQuestionIndex.questionVersion,
    })
    .from(versionQuestionIndex)
    .innerJoin(questionnaireVersion, eq(questionnaireVersion.id, versionQuestionIndex.questionnaireVersionId))
    .where(
      and(
        eq(versionQuestionIndex.questionId, questionId),
        eq(questionnaireVersion.status, "published"),
        isNotNull(questionnaireVersion.version),
      ),
    )
    .orderBy(asc(questionnaireVersion.questionnaireId), desc(questionnaireVersion.version));
  return rows.flatMap((row) => (row.version === null ? [] : [{ ...row, version: row.version }]));
}

export interface ArchiveQuestionCommand {
  readonly questionId: string;
  readonly actorId: string | null;
  readonly traceId: string | null;
}

export type ArchiveQuestionOutcome =
  | { readonly outcome: "archived" | "already-archived"; readonly question: Question }
  | { readonly outcome: "not-found" };

export async function archiveQuestion(executor: Executor, command: ArchiveQuestionCommand): Promise<ArchiveQuestionOutcome> {
  return executor.transaction(async (tx) => {
    const archived = await tx
      .update(question)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(question.id, command.questionId), isNull(question.archivedAt)))
      .returning({ id: question.id });
    if (archived.length === 1) {
      await recordAudit(tx, {
        action: "archive_question",
        questionnaireId: null,
        questionnaireVersionId: null,
        version: null,
        actorId: command.actorId,
        summary: { questionId: command.questionId },
        traceId: command.traceId,
      });
    }
    const current = await findQuestion(tx, command.questionId);
    if (current === undefined) {
      return { outcome: "not-found" };
    }
    return { outcome: archived.length === 1 ? "archived" : "already-archived", question: current };
  });
}
