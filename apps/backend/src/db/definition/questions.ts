import type { Question, QuestionInput } from "@qp/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit.js";
import type { Executor, Transaction } from "../client.js";
import { mustExist } from "../errors.js";
import { question, questionVersion, questionVersionOption } from "../schema.js";
import { questionInputToColumns } from "./question-content.js";
import { readQuestion } from "./question-reads.js";
import { lockQuestion, QUESTION_NOT_FOUND, type QuestionNotFound } from "./question-rows.js";

export interface CreateQuestionCommand {
  readonly seededQuestionId?: string;
  readonly key: string | null;
  readonly content: QuestionInput;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export interface SavedQuestionVersion {
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
  const saved = mustExist(await readQuestion(tx, questionId), "the question version just saved");
  return { questionId, questionVersion: version, question: saved };
}

export async function createQuestion(executor: Executor, command: CreateQuestionCommand): Promise<SavedQuestionVersion> {
  return executor.transaction(async (tx) => {
    const questionId = command.seededQuestionId ?? uuidv7();
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

interface QuestionTypeChanged {
  readonly outcome: "type-changed";
}

const QUESTION_TYPE_CHANGED: QuestionTypeChanged = { outcome: "type-changed" };

export type AppendQuestionVersionOutcome =
  | ({ readonly outcome: "saved" } & SavedQuestionVersion)
  | QuestionNotFound
  | QuestionTypeChanged;

export async function appendQuestionVersion(
  executor: Executor,
  command: AppendQuestionVersionCommand,
): Promise<AppendQuestionVersionOutcome> {
  return executor.transaction(async (tx) => {
    if ((await lockQuestion(tx, command.questionId)) === undefined) {
      return QUESTION_NOT_FOUND;
    }
    const [latest] = await tx
      .select({ version: questionVersion.version, type: questionVersion.type })
      .from(questionVersion)
      .where(eq(questionVersion.questionId, command.questionId))
      .orderBy(desc(questionVersion.version))
      .limit(1);
    if (latest !== undefined && latest.type !== command.content.type) {
      return QUESTION_TYPE_CHANGED;
    }
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
      return QUESTION_NOT_FOUND;
    }
    return { outcome: archived.length === 1 ? "archived" : "already-archived", question: current };
  });
}
