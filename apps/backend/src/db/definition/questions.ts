import type { Question, QuestionInput, QuestionUsage, QuestionVersion, QuestionVersionSummary } from "@qp/shared";
import { and, asc, desc, eq, gt, isNull, max, notExists, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit.js";
import type { Executor, Transaction } from "../client.js";
import { question, questionnaireVersion, questionVersion, questionVersionOption, versionQuestionIndex } from "../schema.js";
import { questionInputToColumns, storedQuestionToVersion } from "./question-content.js";
import { isPublishedVersion, publishedValue } from "./versions.js";
import { questionVersionIn, questionVersionKey, readOptionsInPosition, readQuestionVersions } from "./question-versions.js";

export interface QuestionNotFound {
  readonly outcome: "question-not-found";
}

export interface CreateQuestionCommand {
  readonly questionId?: string;
  readonly key: string | null;
  readonly content: QuestionInput;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export interface SavedQuestion {
  readonly questionId: string;
  readonly questionVersion: number;
  readonly question: Question;
}

async function insertQuestionVersion(
  tx: Transaction,
  questionId: string,
  version: number,
  content: QuestionInput,
  createdBy: string | null,
  traceId: string | null,
): Promise<SavedQuestion> {
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
  const saved = await readQuestion(tx, questionId);
  if (saved === undefined) {
    throw new Error(`question ${questionId} could not be read back after saving version ${version}`);
  }
  return { questionId, questionVersion: version, question: saved };
}

export async function createQuestion(executor: Executor, command: CreateQuestionCommand): Promise<SavedQuestion> {
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
  | ({ readonly outcome: "saved" } & SavedQuestion)
  | QuestionNotFound;

async function lockQuestion(tx: Transaction, questionId: string): Promise<boolean> {
  const locked = await tx.select({ id: question.id }).from(question).where(eq(question.id, questionId)).for("update");
  return locked.length === 1;
}

export async function appendQuestionVersion(
  executor: Executor,
  command: AppendQuestionVersionCommand,
): Promise<AppendQuestionVersionOutcome> {
  return executor.transaction(async (tx) => {
    if (!(await lockQuestion(tx, command.questionId))) {
      return { outcome: "question-not-found" };
    }
    const [latest] = await tx
      .select({ version: max(questionVersion.version) })
      .from(questionVersion)
      .where(eq(questionVersion.questionId, command.questionId));
    const saved = await insertQuestionVersion(
      tx,
      command.questionId,
      (latest?.version ?? 0) + 1,
      command.content,
      command.createdBy,
      command.traceId,
    );
    return { outcome: "saved", ...saved };
  });
}

const newerVersion = alias(questionVersion, "newer_version");

async function readLatestQuestions(executor: Executor, filter: SQL | undefined): Promise<Question[]> {
  const isLatestVersion = notExists(
    executor
      .select({ version: newerVersion.version })
      .from(newerVersion)
      .where(and(eq(newerVersion.questionId, questionVersion.questionId), gt(newerVersion.version, questionVersion.version))),
  );

  const rows = await executor
    .select({
      key: question.key,
      archivedAt: question.archivedAt,
      questionCreatedAt: question.createdAt,
      latest: {
        questionId: questionVersion.questionId,
        version: questionVersion.version,
        type: questionVersion.type,
        prompt: questionVersion.prompt,
        constraints: questionVersion.constraints,
        createdAt: questionVersion.createdAt,
        createdBy: questionVersion.createdBy,
      },
    })
    .from(question)
    .innerJoin(questionVersion, eq(questionVersion.questionId, question.id))
    .where(and(isLatestVersion, filter))
    .orderBy(desc(question.id));

  const optionsByKey = await readOptionsInPosition(executor, questionVersionIn(rows.map((row) => row.latest)));
  return rows.map((row) => ({
    questionId: row.latest.questionId,
    key: row.key,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.questionCreatedAt.toISOString(),
    latest: storedQuestionToVersion(row.latest, optionsByKey.get(questionVersionKey(row.latest)) ?? []),
  }));
}

export interface ListQuestionsQuery {
  readonly includeArchived: boolean;
}

export async function listQuestions(executor: Executor, query: ListQuestionsQuery): Promise<Question[]> {
  return readLatestQuestions(executor, query.includeArchived ? undefined : isNull(question.archivedAt));
}

export async function readQuestion(executor: Executor, questionId: string): Promise<Question | undefined> {
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
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function readQuestionVersion(
  executor: Executor,
  questionId: string,
  version: number,
): Promise<QuestionVersion | undefined> {
  const key = { questionId, version };
  const loaded = (await readQuestionVersions(executor, questionVersionIn([key]))).get(questionVersionKey(key));
  return loaded === undefined ? undefined : storedQuestionToVersion(loaded.stored, loaded.options);
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
    .where(and(eq(versionQuestionIndex.questionId, questionId), isPublishedVersion()))
    .orderBy(asc(questionnaireVersion.questionnaireId), desc(questionnaireVersion.version));
  return rows.map((row) => ({ ...row, version: publishedValue(row.version, "version") }));
}

export interface ArchiveQuestionCommand {
  readonly questionId: string;
  readonly actorId: string | null;
  readonly traceId: string | null;
}

export type ArchiveQuestionOutcome =
  | { readonly outcome: "archived" | "already-archived"; readonly question: Question }
  | QuestionNotFound;

export async function archiveQuestion(executor: Executor, command: ArchiveQuestionCommand): Promise<ArchiveQuestionOutcome> {
  return executor.transaction(async (tx) => {
    const archived = await tx
      .update(question)
      // eslint-disable-next-line no-restricted-syntax -- archived_at takes the database's transaction timestamp, the same clock as every column default
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
    const current = await readQuestion(tx, command.questionId);
    if (current === undefined) {
      return { outcome: "question-not-found" };
    }
    return { outcome: archived.length === 1 ? "archived" : "already-archived", question: current };
  });
}
