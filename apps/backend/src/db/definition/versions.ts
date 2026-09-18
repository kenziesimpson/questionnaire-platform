import { PublishedDefinition, type VersionSummary } from "@qp/shared";
import { desc, sql } from "drizzle-orm";
import { Value } from "typebox/value";
import type { Executor } from "../client.js";
import { mustExist } from "../errors.js";
import { questionnaireVersion } from "../schema.js";
import { isPublishedVersionOf } from "./questionnaire-version-rows.js";
import { questionnaireExists } from "./questionnaire-rows.js";

const PUBLISHER_IS_NOT_RECORDED = null;

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
    version: mustExist(row.version, "a published version's version"),
    publishedAt: mustExist(row.publishedAt, "a published version's publishedAt").toISOString(),
    publishedBy: PUBLISHER_IS_NOT_RECORDED,
    itemCount: Number(row.itemCount),
    formatVersion: mustExist(row.formatVersion, "a published version's formatVersion"),
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
  const definition = mustExist(row.snapshot, "a published version's snapshot");
  if (!Value.Check(PublishedDefinition, definition)) {
    throw new Error("a published snapshot does not match any known format");
  }
  return { formatVersion: mustExist(row.formatVersion, "a published version's formatVersion"), definition };
}
