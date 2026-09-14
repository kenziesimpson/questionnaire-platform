import { PublishedDefinition, type VersionSummary } from "@qp/shared";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { Value } from "typebox/value";
import type { Executor } from "../client.js";
import { questionnaireVersion } from "../schema.js";
import { questionnaireExists } from "./questionnaire-rows.js";

const PUBLISHER_IS_NOT_RECORDED = null;

export function isPublishedVersion(): SQL {
  return eq(questionnaireVersion.status, "published");
}

export function isPublishedVersionOf(questionnaireId: string, version?: number): SQL | undefined {
  return and(
    eq(questionnaireVersion.questionnaireId, questionnaireId),
    isPublishedVersion(),
    version === undefined ? undefined : eq(questionnaireVersion.version, version),
  );
}

export function publishedValue<Value>(value: Value | null, column: string): Value {
  if (value === null) {
    throw new Error(`a published questionnaire version is missing its ${column}`);
  }
  return value;
}

export interface PublishedSnapshot {
  readonly formatVersion: number;
  readonly definition: PublishedDefinition;
}

async function selectVersionSummaries(executor: Executor, questionnaireId: string, version?: number): Promise<VersionSummary[]> {
  const rows = await executor
    .select({
      questionnaireId: questionnaireVersion.questionnaireId,
      version: questionnaireVersion.version,
      publishedAt: questionnaireVersion.publishedAt,
      // eslint-disable-next-line no-restricted-syntax -- counts snapshot items inside Postgres so version history never transfers the snapshots themselves (7-application-boundary §4.2); the query builder has no JSONB functions
      itemCount: sql<number>`jsonb_array_length(${questionnaireVersion.snapshot} -> 'items')`,
      formatVersion: questionnaireVersion.formatVersion,
    })
    .from(questionnaireVersion)
    .where(isPublishedVersionOf(questionnaireId, version))
    .orderBy(desc(questionnaireVersion.version));

  return rows.map((row) => ({
    questionnaireId: row.questionnaireId,
    version: publishedValue(row.version, "version"),
    publishedAt: publishedValue(row.publishedAt, "publishedAt").toISOString(),
    publishedBy: PUBLISHER_IS_NOT_RECORDED,
    itemCount: Number(row.itemCount),
    formatVersion: publishedValue(row.formatVersion, "formatVersion"),
  }));
}

export async function listVersionSummaries(executor: Executor, questionnaireId: string): Promise<VersionSummary[] | undefined> {
  if (!(await questionnaireExists(executor, questionnaireId))) {
    return undefined;
  }
  return selectVersionSummaries(executor, questionnaireId);
}

export async function readVersionSummary(
  executor: Executor,
  questionnaireId: string,
  version: number,
): Promise<VersionSummary | undefined> {
  const [summary] = await selectVersionSummaries(executor, questionnaireId, version);
  return summary;
}

export async function readPublishedSnapshot(
  executor: Executor,
  questionnaireId: string,
  version: number,
): Promise<PublishedSnapshot | undefined> {
  const [row] = await executor
    .select({ snapshot: questionnaireVersion.snapshot, formatVersion: questionnaireVersion.formatVersion })
    .from(questionnaireVersion)
    .where(isPublishedVersionOf(questionnaireId, version));
  if (row === undefined) {
    return undefined;
  }
  const definition = publishedValue(row.snapshot, "snapshot");
  if (!Value.Check(PublishedDefinition, definition)) {
    throw new Error("a published snapshot does not match any known format");
  }
  return { formatVersion: publishedValue(row.formatVersion, "formatVersion"), definition };
}
