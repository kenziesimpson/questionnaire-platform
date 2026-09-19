import type { ClientAnswers, ClientAnswerValue, ResponseRow } from "@qp/shared";
import { and, inArray } from "drizzle-orm";
import type { Executor } from "../client.js";
import { response } from "../schema.js";

const responseColumns = {
  sessionId: response.sessionId,
  itemId: response.itemId,
  questionId: response.questionId,
  questionVersion: response.questionVersion,
  questionType: response.questionType,
  textValue: response.textValue,
  numberValue: response.numberValue,
  numberUnit: response.numberUnit,
  dateValue: response.dateValue,
  optionIds: response.optionIds,
  otherText: response.otherText,
};

function requireValue<V>(value: V | null, column: string, itemId: string): V {
  if (value === null) {
    throw new Error(`response row for item "${itemId}" is missing its ${column} value`);
  }
  return value;
}

interface StoredResponseRow {
  readonly sessionId: string;
  readonly itemId: string;
  readonly questionId: string;
  readonly questionVersion: number;
  readonly questionType: "text" | "single_choice" | "multiple_choice" | "number" | "date";
  readonly textValue: string | null;
  readonly numberValue: string | null;
  readonly numberUnit: string | null;
  readonly dateValue: string | null;
  readonly optionIds: string[] | null;
  readonly otherText: string | null;
}

function responseRowOf(row: StoredResponseRow): ResponseRow {
  const head = { itemId: row.itemId, questionId: row.questionId, questionVersion: row.questionVersion };
  switch (row.questionType) {
    case "text":
      return { ...head, type: "text", text: requireValue(row.textValue, "text_value", row.itemId) };
    case "number":
      return {
        ...head,
        type: "number",
        number: requireValue(row.numberValue, "number_value", row.itemId),
        ...(row.numberUnit === null ? {} : { unit: row.numberUnit }),
      };
    case "date":
      return { ...head, type: "date", date: requireValue(row.dateValue, "date_value", row.itemId) };
    case "single_choice": {
      const optionIds = requireValue(row.optionIds, "option_ids", row.itemId);
      return {
        ...head,
        type: "single_choice",
        optionIds: optionIds.slice(0, 1),
        ...(row.otherText === null ? {} : { otherText: row.otherText }),
      };
    }
    case "multiple_choice":
      return {
        ...head,
        type: "multiple_choice",
        optionIds: requireValue(row.optionIds, "option_ids", row.itemId),
        ...(row.otherText === null ? {} : { otherText: row.otherText }),
      };
  }
}

export interface SubmittedSessionRef {
  readonly id: string;
  readonly submittedAt: Date;
}

export async function responseRowsBySession(
  executor: Executor,
  sessions: readonly SubmittedSessionRef[],
): Promise<ReadonlyMap<string, ResponseRow[]>> {
  const grouped = new Map<string, ResponseRow[]>();
  if (sessions.length === 0) {
    return grouped;
  }
  const sessionIds = sessions.map((ref) => ref.id);
  const partitionKeys = [...new Map(sessions.map((ref) => [ref.submittedAt.getTime(), ref.submittedAt])).values()];
  const rows = await executor
    .select(responseColumns)
    .from(response)
    .where(and(inArray(response.sessionId, sessionIds), inArray(response.createdAt, partitionKeys)));
  for (const row of rows) {
    const stored: StoredResponseRow = row;
    const bucket = grouped.get(stored.sessionId);
    const parsed = responseRowOf(stored);
    if (bucket === undefined) {
      grouped.set(stored.sessionId, [parsed]);
    } else {
      bucket.push(parsed);
    }
  }
  return grouped;
}

export function answersFromResponseRows(rows: readonly ResponseRow[]): ClientAnswers {
  const answers: ClientAnswers = {};
  for (const row of rows) {
    answers[row.itemId] = clientAnswerValueOf(row);
  }
  return answers;
}

function clientAnswerValueOf(row: ResponseRow): ClientAnswerValue {
  switch (row.type) {
    case "text":
      return { type: "text", text: row.text };
    case "single_choice":
      return {
        type: "single_choice",
        optionId: requireValue(row.optionIds[0] ?? null, "option_ids[0]", row.itemId),
        ...(row.otherText === undefined ? {} : { otherText: row.otherText }),
      };
    case "multiple_choice":
      return {
        type: "multiple_choice",
        optionIds: [...row.optionIds],
        ...(row.otherText === undefined ? {} : { otherText: row.otherText }),
      };
    case "number":
      return { type: "number", value: row.number };
    case "date":
      return { type: "date", date: row.date };
  }
}
