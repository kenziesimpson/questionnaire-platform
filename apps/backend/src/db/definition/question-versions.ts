import { and, asc, eq, exists, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "../client.js";
import { questionnaireItem, questionVersion, questionVersionOption } from "../schema.js";
import type { StoredOption, StoredQuestionVersionRow } from "./question-content.js";

export interface QuestionVersionKey {
  readonly questionId: string;
  readonly version: number;
}

export interface LoadedQuestionVersion {
  readonly stored: StoredQuestionVersionRow;
  readonly options: readonly StoredOption[];
}

export type QuestionVersionScope = (executor: Executor, questionIdColumn: PgColumn, versionColumn: PgColumn) => SQL | undefined;

export function questionVersionKey({ questionId, version }: QuestionVersionKey): string {
  return `${questionId}:${version}`;
}

export function pinnedByDraft(draftVersionId: string): QuestionVersionScope {
  return (executor, questionIdColumn, versionColumn) =>
    exists(
      executor
        .select({ itemId: questionnaireItem.itemId })
        .from(questionnaireItem)
        .where(
          and(
            eq(questionnaireItem.questionnaireVersionId, draftVersionId),
            eq(questionnaireItem.questionId, questionIdColumn),
            eq(questionnaireItem.questionVersion, versionColumn),
          ),
        ),
    );
}

export function questionVersionIn(keys: readonly QuestionVersionKey[]): QuestionVersionScope {
  return (_executor, questionIdColumn, versionColumn) =>
    or(...keys.map((key) => and(eq(questionIdColumn, key.questionId), eq(versionColumn, key.version))));
}

export async function readOptionsInPosition(executor: Executor, scope: QuestionVersionScope): Promise<Map<string, StoredOption[]>> {
  const optionsByKey = new Map<string, StoredOption[]>();
  const inScope = scope(executor, questionVersionOption.questionId, questionVersionOption.version);
  if (inScope === undefined) {
    return optionsByKey;
  }
  const rows = await executor
    .select({
      questionId: questionVersionOption.questionId,
      version: questionVersionOption.version,
      optionId: questionVersionOption.optionId,
      label: questionVersionOption.label,
      freeform: questionVersionOption.freeform,
    })
    .from(questionVersionOption)
    .where(inScope)
    .orderBy(asc(questionVersionOption.position));
  for (const { questionId, version, ...option } of rows) {
    const key = questionVersionKey({ questionId, version });
    optionsByKey.set(key, [...(optionsByKey.get(key) ?? []), option]);
  }
  return optionsByKey;
}

export async function readQuestionVersions(executor: Executor, scope: QuestionVersionScope): Promise<Map<string, LoadedQuestionVersion>> {
  const inScope = scope(executor, questionVersion.questionId, questionVersion.version);
  if (inScope === undefined) {
    return new Map();
  }
  const rows = await executor
    .select({
      questionId: questionVersion.questionId,
      version: questionVersion.version,
      type: questionVersion.type,
      prompt: questionVersion.prompt,
      constraints: questionVersion.constraints,
      createdAt: questionVersion.createdAt,
      createdBy: questionVersion.createdBy,
    })
    .from(questionVersion)
    .where(inScope);
  const optionsByKey = await readOptionsInPosition(executor, scope);
  return new Map(
    rows.map((stored) => {
      const key = questionVersionKey(stored);
      return [key, { stored, options: optionsByKey.get(key) ?? [] }];
    }),
  );
}
