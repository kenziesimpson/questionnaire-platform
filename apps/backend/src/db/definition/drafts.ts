import {
  validateDraft,
  type DraftItem,
  type DraftValidation,
  type QuestionnaireDraft,
  type QuestionnaireSummary,
} from "@qp/shared";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { desc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit.js";
import { isCurrentDraft, type DraftPrecondition } from "./draft-precondition.js";
import type { Database, Executor, Transaction } from "../client.js";
import { questionnaire, questionnaireItem, questionnaireVersion } from "../schema.js";
import {
  archivedQuestionIds,
  draftForValidation,
  insertItems,
  itemsWithQuestionContent,
  pinnedQuestionVersionsInPlacementOrder,
  readDraftContents,
  readItems,
  type DraftInvalidItem,
} from "./draft-contents.js";
import { readQuestionnaireSummary } from "./questionnaire-list.js";
import {
  isPublishedVersionOf,
  lockOpenDraft,
  readOpenDraft,
  withLockedQuestionnaire,
  type QuestionnaireNotFound,
} from "./questionnaire-rows.js";
import { existingQuestionVersionKeys, questionVersionKey, type QuestionVersionKey } from "./question-versions.js";

const READ_ONLY_SNAPSHOT: PgTransactionConfig = { isolationLevel: "repeatable read", accessMode: "read only" };

export interface CreateQuestionnaireCommand {
  readonly questionnaireId?: string;
  readonly key: string | null;
  readonly name: string;
  readonly title: string;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export interface CreatedQuestionnaire {
  readonly questionnaireId: string;
  readonly draftVersionId: string;
  readonly draftRevision: number;
  readonly summary: QuestionnaireSummary;
}

export async function createQuestionnaire(
  executor: Executor,
  command: CreateQuestionnaireCommand,
): Promise<CreatedQuestionnaire> {
  return executor.transaction(async (tx) => {
    const questionnaireId = command.questionnaireId ?? uuidv7();
    const draftVersionId = uuidv7();
    await tx.insert(questionnaire).values({ id: questionnaireId, key: command.key, name: command.name });
    const [draft] = await tx
      .insert(questionnaireVersion)
      .values({
        id: draftVersionId,
        questionnaireId,
        status: "draft",
        title: command.title,
        createdBy: command.createdBy,
      })
      .returning({ draftRevision: questionnaireVersion.draftRevision });
    const summary = await readQuestionnaireSummary(tx, questionnaireId);
    if (draft === undefined || summary === undefined) {
      throw new Error("creating a questionnaire returned no row");
    }
    await recordAudit(tx, {
      action: "create_draft",
      questionnaireId,
      questionnaireVersionId: draftVersionId,
      version: null,
      actorId: command.createdBy,
      summary: null,
      traceId: command.traceId,
    });
    return { questionnaireId, draftVersionId, draftRevision: draft.draftRevision, summary };
  });
}

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

async function refusedItems(tx: Transaction, items: readonly DraftItem[]): Promise<DraftInvalidItem[]> {
  const duplicated = duplicatedItemIds(items);
  if (duplicated.length > 0) {
    return duplicated.map((itemId) => ({ itemId, code: "draft/duplicate-item-id" }));
  }
  const archivedIds = await archivedQuestionIds(tx, items.map((item) => item.questionId));
  if (archivedIds.size > 0) {
    return items
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
    const refused = await refusedItems(tx, command.items);
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
    const saved = await readCurrentDraft(tx, command.questionnaireId);
    if (saved === undefined) {
      throw new Error("the draft just saved could not be read back");
    }
    return { outcome: "saved", draftVersionId: draft.id, ...saved };
  });
}

export interface OpenNextDraftCommand {
  readonly questionnaireId: string;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export type OpenNextDraftOutcome =
  | ({ readonly outcome: "opened" } & CurrentDraft)
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

export async function openNextDraft(executor: Executor, command: OpenNextDraftCommand): Promise<OpenNextDraftOutcome> {
  return withLockedQuestionnaire(executor, command.questionnaireId, async (tx): Promise<OpenNextDraftOutcome> => {
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

    const opened = await readCurrentDraft(tx, command.questionnaireId);
    if (opened === undefined) {
      throw new Error("the draft just opened could not be read back");
    }
    return { outcome: "opened", ...opened };
  });
}

export async function validateOpenDraft(database: Database, questionnaireId: string): Promise<DraftValidation | undefined> {
  return database.transaction(async (tx) => {
    const draft = await readOpenDraft(tx, questionnaireId);
    if (draft === undefined) {
      return undefined;
    }
    return validateDraft(await draftForValidation(tx, itemsWithQuestionContent(await readDraftContents(tx, draft.id))));
  }, READ_ONLY_SNAPSHOT);
}
