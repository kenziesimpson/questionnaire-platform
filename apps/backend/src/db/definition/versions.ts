import type { PublishedDefinition, VersionSummary } from "@qp/shared";
import { desc, sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { questionnaireVersion } from "../schema.js";
import { isPublishedVersionOf, publishedValue, questionnaireExists } from "./questionnaire-rows.js";

const PUBLISHER_IS_NOT_RECORDED = null;

export type VersionHistoryOutcome =
  | { readonly outcome: "found"; readonly versions: VersionSummary[] }
  | { readonly outcome: "questionnaire-not-found" };

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

export async function listVersionSummaries(executor: Executor, questionnaireId: string): Promise<VersionHistoryOutcome> {
  if (!(await questionnaireExists(executor, questionnaireId))) {
    return { outcome: "questionnaire-not-found" };
  }
  return { outcome: "found", versions: await selectVersionSummaries(executor, questionnaireId) };
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
  return {
    formatVersion: publishedValue(row.formatVersion, "formatVersion"),
    definition: publishedValue(row.snapshot, "snapshot") as PublishedDefinition,
  };
}
