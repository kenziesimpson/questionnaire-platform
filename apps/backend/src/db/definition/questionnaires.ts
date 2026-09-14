import {
  validateDraft,
  type DraftItem,
  type DraftValidation,
  type QuestionnaireDraft,
  type QuestionnaireSummary,
} from "@qp/shared";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit.js";
import { isCurrentDraft, type DraftPrecondition } from "./draft-precondition.js";
import type { Database, Executor, Transaction } from "../client.js";
import { question, questionnaire, questionnaireItem, questionnaireVersion, questionVersion } from "../schema.js";
import { draftForValidation, itemsWithQuestionContent, pinnedQuestionVersionsInPlacementOrder, readDraftContents } from "./draft-contents.js";
import { lockOpenDraft, readOpenDraft, withLockedQuestionnaire, type QuestionnaireNotFound } from "./questionnaire-rows.js";
import { questionVersionKey } from "./question-versions.js";

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
    const [created] = await tx
      .insert(questionnaire)
      .values({ id: questionnaireId, key: command.key, name: command.name })
      .returning({ createdAt: questionnaire.createdAt });
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
    await recordAudit(tx, {
      action: "create_draft",
      questionnaireId,
      questionnaireVersionId: draftVersionId,
      version: null,
      actorId: command.createdBy,
      summary: null,
      traceId: command.traceId,
    });
    if (created === undefined || draft === undefined) {
      throw new Error("creating a questionnaire returned no row");
    }
    return {
      questionnaireId,
      draftVersionId,
      draftRevision: draft.draftRevision,
      summary: {
        questionnaireId,
        key: command.key,
        name: command.name,
        currentVersion: null,
        closesAt: null,
        hasDraft: true,
        createdAt: created.createdAt.toISOString(),
      },
    };
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

type RefusedPlacement =
  | { readonly outcome: "duplicate-item-id"; readonly itemIds: readonly string[] }
  | { readonly outcome: "archived-question"; readonly questionIds: readonly string[] }
  | { readonly outcome: "unknown-question-version"; readonly itemIds: readonly string[] };

export type ReplaceDraftOutcome =
  | ({ readonly outcome: "saved"; readonly draftVersionId: string } & CurrentDraft)
  | { readonly outcome: "stale" }
  | { readonly outcome: "no-draft" }
  | RefusedPlacement;

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

async function refusedPlacement(tx: Transaction, items: readonly DraftItem[]): Promise<RefusedPlacement | undefined> {
  const duplicated = duplicatedItemIds(items);
  if (duplicated.length > 0) {
    return { outcome: "duplicate-item-id", itemIds: duplicated };
  }
  const questionIds = [...new Set(items.map((item) => item.questionId))];
  if (questionIds.length === 0) {
    return undefined;
  }
  const archived = await tx
    .select({ id: question.id })
    .from(question)
    .where(and(inArray(question.id, questionIds), isNotNull(question.archivedAt)));
  if (archived.length > 0) {
    return { outcome: "archived-question", questionIds: archived.map((row) => row.id) };
  }
  const known = await tx
    .select({ questionId: questionVersion.questionId, version: questionVersion.version })
    .from(questionVersion)
    .where(inArray(questionVersion.questionId, questionIds));
  const knownKeys = new Set(known.map((row) => questionVersionKey(row)));
  const unknownItemIds = items
    .filter((item) => !knownKeys.has(questionVersionKey({ questionId: item.questionId, version: item.questionVersion })))
    .map((item) => item.itemId);
  return unknownItemIds.length > 0 ? { outcome: "unknown-question-version", itemIds: unknownItemIds } : undefined;
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
    const refused = await refusedPlacement(tx, command.items);
    if (refused !== undefined) {
      return refused;
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
    if (command.items.length > 0) {
      await tx.insert(questionnaireItem).values(
        command.items.map((item, position) => ({
          questionnaireVersionId: draft.id,
          itemId: item.itemId,
          position,
          required: item.required,
          visibleWhen: item.visibleWhen,
          questionId: item.questionId,
          questionVersion: item.questionVersion,
        })),
      );
    }
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
    .where(and(eq(questionnaireVersion.questionnaireId, questionnaireId), eq(questionnaireVersion.status, "published")))
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
    const sourceItems = await tx
      .select({
        itemId: questionnaireItem.itemId,
        position: questionnaireItem.position,
        required: questionnaireItem.required,
        visibleWhen: questionnaireItem.visibleWhen,
        questionId: questionnaireItem.questionId,
        questionVersion: questionnaireItem.questionVersion,
      })
      .from(questionnaireItem)
      .where(eq(questionnaireItem.questionnaireVersionId, source.id))
      .orderBy(asc(questionnaireItem.position));
    if (sourceItems.length > 0) {
      await tx.insert(questionnaireItem).values(sourceItems.map((item) => ({ ...item, questionnaireVersionId: draftVersionId })));
    }
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
