import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Executor, Transaction } from "../client.js";
import { question } from "../schema.js";
import { lockedRow, rowExists, type RowsById } from "./questionnaire-rows.js";

interface QuestionRow {
  readonly id: string;
}

export interface QuestionNotFound {
  readonly outcome: "question-not-found";
}

export const QUESTION_NOT_FOUND: QuestionNotFound = { outcome: "question-not-found" };

function selectQuestion(executor: Executor, questionId: string): RowsById<QuestionRow> {
  return executor.select({ id: question.id }).from(question).where(eq(question.id, questionId));
}

export async function lockQuestion(tx: Transaction, questionId: string): Promise<QuestionRow | undefined> {
  return lockedRow(selectQuestion(tx, questionId));
}

export async function questionExists(executor: Executor, questionId: string): Promise<boolean> {
  return rowExists(selectQuestion(executor, questionId));
}

export async function archivedQuestionIds(executor: Executor, questionIds: readonly string[]): Promise<Set<string>> {
  const distinct = [...new Set(questionIds)];
  if (distinct.length === 0) {
    return new Set();
  }
  const archived = await executor
    .select({ id: question.id })
    .from(question)
    .where(and(inArray(question.id, distinct), isNotNull(question.archivedAt)));
  return new Set(archived.map((row) => row.id));
}
