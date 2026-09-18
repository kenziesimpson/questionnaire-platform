import { draftForValidation, validateDraft, type DraftItem, type DraftValidation, type QuestionnaireDraft } from "@qp/shared";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { desc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit.js";
import { isCurrentDraft, type DraftPrecondition } from "./draft-precondition.js";
import type { Database, Executor, Transaction } from "../client.js";
import { questionnaireItem, questionnaireVersion } from "../schema.js";
import {
  archivedQuestionIds,
  itemsWithQuestionContent,
  pinnedQuestionVersionsInPlacementOrder,
  readDraftContents,
  type DraftInvalidItem,
} from "./draft-contents.js";
import { insertItems, readItems } from "./questionnaire-items.js";
import { readBack } from "./read-back.js";
import { lockOpenDraft, readOpenDraft, withLockedQuestionnaire, type QuestionnaireNotFound } from "./questionnaire-rows.js";
import { existingQuestionVersionKeys, questionVersionKey, type QuestionVersionKey } from "./question-versions.js";
import { isPublishedVersionOf } from "./versions.js";

const READ_ONLY_SNAPSHOT: PgTransactionConfig = { isolationLevel: "repeatable read", accessMode: "read only" };

export interface CurrentDraft {
  readonly draft: QuestionnaireDraft;
  readonly draftRevision: number;
}

async function readCurrentDraft(executor: Executor, questionnaireId: string): Promise<CurrentDraft | undefined> {
  const version = await readOpenDraft(executor, questionnaireId);
  if (version === undefined) {
    return undefined;
  }
  const contents = await readDraftContents(executor, version.id);
  return {
    draft: {
      questionnaireId,
      versionId: version.id,
      title: version.title,
      updatedAt: version.updatedAt.toISOString(),
      items: [...contents.items],
      questions: pinnedQuestionVersionsInPlacementOrder(contents),
    },
    draftRevision: version.draftRevision,
  };
}

export async function readDraft(database: Database, questionnaireId: string): Promise<CurrentDraft | undefined> {
  return database.transaction((tx) => readCurrentDraft(tx, questionnaireId), READ_ONLY_SNAPSHOT);
}

export interface ReplaceDraftCommand {
  readonly questionnaireId: string;
  readonly precondition: DraftPrecondition;
  readonly title: string;
  readonly items: readonly DraftItem[];
  readonly actorId: string | null;
  readonly traceId: string | null;
}

export type ReplaceDraftOutcome =
  | ({ readonly outcome: "saved"; readonly draftVersionId: string } & CurrentDraft)
  | { readonly outcome: "stale" }
  | { readonly outcome: "no-draft" }
  | { readonly outcome: "invalid"; readonly items: readonly DraftInvalidItem[] };

function duplicatedItemIds(items: readonly DraftItem[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const item of items) {
    if (seen.has(item.itemId)) {
      duplicated.add(item.itemId);
    }
    seen.add(item.itemId);
  }
  return [...duplicated];
}

function pinnedVersionOf(item: DraftItem): QuestionVersionKey {
  return { questionId: item.questionId, version: item.questionVersion };
}

function newPlacements(items: readonly DraftItem[], placed: readonly DraftItem[]): DraftItem[] {
  const placedKeys = new Set(placed.map((item) => questionVersionKey(pinnedVersionOf(item))));
  return items.filter((item) => !placedKeys.has(questionVersionKey(pinnedVersionOf(item))));
}

async function refusedItems(tx: Transaction, draftVersionId: string, items: readonly DraftItem[]): Promise<DraftInvalidItem[]> {
  const duplicated = duplicatedItemIds(items);
  if (duplicated.length > 0) {
    return duplicated.map((itemId) => ({ itemId, code: "draft/duplicate-item-id" }));
  }
  const added = newPlacements(items, await readItems(tx, draftVersionId));
  const archivedIds = await archivedQuestionIds(tx, added.map((item) => item.questionId));
  if (archivedIds.size > 0) {
    return added
      .filter((item) => archivedIds.has(item.questionId))
      .map((item) => ({ itemId: item.itemId, code: "draft/question-archived" }));
  }
  const knownKeys = await existingQuestionVersionKeys(tx, items.map(pinnedVersionOf));
  return items
    .filter((item) => !knownKeys.has(questionVersionKey(pinnedVersionOf(item))))
    .map((item) => ({ itemId: item.itemId, code: "draft/question-version-unknown" }));
}

export async function replaceDraft(executor: Executor, command: ReplaceDraftCommand): Promise<ReplaceDraftOutcome> {
  return executor.transaction(async (tx) => {
    const draft = await lockOpenDraft(tx, command.questionnaireId);
    if (draft === undefined) {
      return { outcome: "no-draft" };
    }
    if (!isCurrentDraft(command.precondition, { versionId: draft.id, draftRevision: draft.draftRevision })) {
      return { outcome: "stale" };
    }
    const refused = await refusedItems(tx, draft.id, command.items);
    if (refused.length > 0) {
      return { outcome: "invalid", items: refused };
    }

    await tx
      .update(questionnaireVersion)
      .set({
        title: command.title,
        draftRevision: draft.draftRevision + 1,
        // eslint-disable-next-line no-restricted-syntax -- updated_at takes the database's transaction timestamp, the same clock as every column default
        updatedAt: sql`now()`,
      })
      .where(eq(questionnaireVersion.id, draft.id));
    await tx.delete(questionnaireItem).where(eq(questionnaireItem.questionnaireVersionId, draft.id));
    await insertItems(tx, draft.id, command.items);
    await recordAudit(tx, {
      action: "edit_draft",
      questionnaireId: command.questionnaireId,
      questionnaireVersionId: draft.id,
      version: null,
      actorId: command.actorId,
      summary: { title: command.title, itemIds: command.items.map((item) => item.itemId) },
      traceId: command.traceId,
    });
    const saved = readBack(await readCurrentDraft(tx, command.questionnaireId), "the draft just saved");
    return { outcome: "saved", draftVersionId: draft.id, ...saved };
  });
}

export interface CreateNextDraftCommand {
  readonly questionnaireId: string;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export type CreateNextDraftOutcome =
  | ({ readonly outcome: "created" } & CurrentDraft)
  | QuestionnaireNotFound
  | { readonly outcome: "draft-exists" }
  | { readonly outcome: "nothing-published" };

async function latestPublishedVersion(tx: Transaction, questionnaireId: string) {
  const [latest] = await tx
    .select({ id: questionnaireVersion.id, title: questionnaireVersion.title, version: questionnaireVersion.version })
    .from(questionnaireVersion)
    .where(isPublishedVersionOf(questionnaireId))
    .orderBy(desc(questionnaireVersion.version))
    .limit(1);
  return latest;
}

export async function createNextDraft(executor: Executor, command: CreateNextDraftCommand): Promise<CreateNextDraftOutcome> {
  return withLockedQuestionnaire(executor, command.questionnaireId, async (tx): Promise<CreateNextDraftOutcome> => {
    if ((await readOpenDraft(tx, command.questionnaireId)) !== undefined) {
      return { outcome: "draft-exists" };
    }
    const source = await latestPublishedVersion(tx, command.questionnaireId);
    if (source === undefined) {
      return { outcome: "nothing-published" };
    }

    const draftVersionId = uuidv7();
    await tx.insert(questionnaireVersion).values({
      id: draftVersionId,
      questionnaireId: command.questionnaireId,
      status: "draft",
      title: source.title,
      createdBy: command.createdBy,
    });
    await insertItems(tx, draftVersionId, await readItems(tx, source.id));
    await recordAudit(tx, {
      action: "create_draft",
      questionnaireId: command.questionnaireId,
      questionnaireVersionId: draftVersionId,
      version: null,
      actorId: command.createdBy,
      summary: { copiedFromVersion: source.version },
      traceId: command.traceId,
    });

    const created = readBack(await readCurrentDraft(tx, command.questionnaireId), "the next draft just created");
    return { outcome: "created", ...created };
  });
}

export async function validateOpenDraft(database: Database, questionnaireId: string): Promise<DraftValidation | undefined> {
  return database.transaction(async (tx) => {
    const draft = await readOpenDraft(tx, questionnaireId);
    if (draft === undefined) {
      return undefined;
    }
    return validateDraft(draftForValidation(itemsWithQuestionContent(await readDraftContents(tx, draft.id))));
  }, READ_ONLY_SNAPSHOT);
}
