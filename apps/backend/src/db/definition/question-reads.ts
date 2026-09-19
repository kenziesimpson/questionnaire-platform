import type { Question, QuestionUsage, QuestionVersion, QuestionVersionSummary } from "@qp/shared";
import { and, asc, desc, eq, gt, isNull, notExists, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../client.js";
import { mustExist } from "../errors.js";
import { question, questionnaireVersion, questionVersion, versionQuestionIndex } from "../schema.js";
import { storedQuestionToVersion } from "./question-content.js";
import { questionExists } from "./question-rows.js";
import { questionVersionIn, questionVersionKey, readQuestionVersions } from "./question-versions.js";
import { isPublishedVersion } from "./questionnaire-version-rows.js";

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
      questionId: question.id,
      key: question.key,
      archivedAt: question.archivedAt,
      createdAt: question.createdAt,
      version: questionVersion.version,
    })
    .from(question)
    .innerJoin(questionVersion, eq(questionVersion.questionId, question.id))
    .where(and(isLatestVersion, filter))
    .orderBy(desc(question.id));

  const loaded = await readQuestionVersions(executor, questionVersionIn(rows));
  return rows.map((row) => {
    const latest = mustExist(loaded.get(questionVersionKey(row)), "question.latest-version-not-loaded", { questionId: row.questionId });
    return {
      questionId: row.questionId,
      key: row.key,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      latest: storedQuestionToVersion(latest.stored, latest.options),
    };
  });
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
  return rows.map((row) => ({ ...row, version: mustExist(row.version, "published-version.missing-version", { questionnaireId: row.questionnaireId }) }));
}
