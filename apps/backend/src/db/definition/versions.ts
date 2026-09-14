import type { PublishedDefinition, VersionSummary } from "@qp/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { questionnaireVersion } from "../schema.js";
import { questionnaireExists } from "./questionnaire-rows.js";

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
    .where(
      and(
        eq(questionnaireVersion.questionnaireId, questionnaireId),
        eq(questionnaireVersion.status, "published"),
        version === undefined ? undefined : eq(questionnaireVersion.version, version),
      ),
    )
    .orderBy(desc(questionnaireVersion.version));

  return rows.map((row) => {
    if (row.version === null || row.publishedAt === null || row.formatVersion === null) {
      throw new Error("a published questionnaire version is missing its version, publishedAt or formatVersion");
    }
    return {
      questionnaireId: row.questionnaireId,
      version: row.version,
      publishedAt: row.publishedAt.toISOString(),
      publishedBy: PUBLISHER_IS_NOT_RECORDED,
      itemCount: Number(row.itemCount),
      formatVersion: row.formatVersion,
    };
  });
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
    .where(
      and(
        eq(questionnaireVersion.questionnaireId, questionnaireId),
        eq(questionnaireVersion.status, "published"),
        eq(questionnaireVersion.version, version),
      ),
    );
  if (row === undefined) {
    return undefined;
  }
  if (row.snapshot === null || row.formatVersion === null) {
    throw new Error("a published questionnaire version is missing its snapshot or formatVersion");
  }
  return { formatVersion: row.formatVersion, definition: row.snapshot as PublishedDefinition };
}
