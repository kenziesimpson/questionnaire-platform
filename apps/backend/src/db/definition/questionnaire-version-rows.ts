import type { DraftPrecondition } from "@qp/shared";
import { and, eq, exists, type SQL } from "drizzle-orm";
import type { Executor, Transaction } from "../client.js";
import { questionnaire, questionnaireVersion } from "../schema.js";
import { lockedRow } from "./questionnaire-rows.js";

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

function isOpenDraftOf(questionnaireId: string | typeof questionnaire.id) {
  return and(eq(questionnaireVersion.questionnaireId, questionnaireId), eq(questionnaireVersion.status, "draft"));
}

export interface OpenDraftRow {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: Date;
  readonly draftRevision: number;
}

function selectOpenDraft(executor: Executor, questionnaireId: string) {
  return executor
    .select({
      id: questionnaireVersion.id,
      title: questionnaireVersion.title,
      updatedAt: questionnaireVersion.updatedAt,
      draftRevision: questionnaireVersion.draftRevision,
    })
    .from(questionnaireVersion)
    .where(isOpenDraftOf(questionnaireId));
}

export async function readOpenDraft(executor: Executor, questionnaireId: string): Promise<OpenDraftRow | undefined> {
  const [draft] = await selectOpenDraft(executor, questionnaireId);
  return draft;
}

export function openDraftExists(executor: Executor, questionnaireId: string | typeof questionnaire.id) {
  return exists(
    executor.select({ id: questionnaireVersion.id }).from(questionnaireVersion).where(isOpenDraftOf(questionnaireId)),
  ).mapWith(Boolean);
}

export interface DraftWriteCommand {
  readonly questionnaireId: string;
  readonly precondition: DraftPrecondition;
}

export type DraftNotWritable = { readonly outcome: "no-draft" } | { readonly outcome: "stale" };

const NO_DRAFT: DraftNotWritable = { outcome: "no-draft" };
const STALE: DraftNotWritable = { outcome: "stale" };

export async function withCurrentDraft<Outcome>(
  tx: Transaction,
  command: DraftWriteCommand,
  work: (draft: OpenDraftRow) => Promise<Outcome>,
): Promise<Outcome | DraftNotWritable> {
  const draft = await lockedRow(selectOpenDraft(tx, command.questionnaireId));
  if (draft === undefined) {
    return NO_DRAFT;
  }
  const { versionId, draftRevision } = command.precondition;
  if (versionId !== draft.id || draftRevision !== draft.draftRevision) {
    return STALE;
  }
  return work(draft);
}
