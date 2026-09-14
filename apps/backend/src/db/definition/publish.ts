import {
  FORMAT_VERSION,
  PublishedDefinition,
  validateDraft,
  type DraftForValidation,
  type DraftItemCode,
  type Item,
  type ItemError,
  type Predicate,
} from "@qp/shared";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Value } from "typebox/value";
import { recordAudit } from "../audit.js";
import type { Executor, Transaction } from "../client.js";
import {
  question,
  questionnaire,
  questionnaireItem,
  questionnaireVersion,
  questionVersion,
  questionVersionOption,
} from "../schema.js";
import { storedQuestionToContent, type StoredOption } from "./question-content.js";

export interface PublishDraftCommand {
  readonly questionnaireId: string;
  readonly expectedDraftRevision: number;
  readonly actorId: string | null;
  readonly traceId: string | null;
}

export type DraftInvalidItem = ItemError<DraftItemCode>;

export type PublishDraftOutcome =
  | {
      readonly outcome: "published";
      readonly questionnaireVersionId: string;
      readonly version: number;
      readonly definition: PublishedDefinition;
    }
  | { readonly outcome: "questionnaire-not-found" }
  | { readonly outcome: "no-draft" }
  | { readonly outcome: "stale"; readonly draftRevision: number }
  | { readonly outcome: "invalid"; readonly items: readonly DraftInvalidItem[] };

async function lockQuestionnaire(tx: Transaction, questionnaireId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: questionnaire.id })
    .from(questionnaire)
    .where(eq(questionnaire.id, questionnaireId))
    .for("update");
  return rows.length === 1;
}

async function lockDraft(tx: Transaction, questionnaireId: string) {
  const [draft] = await tx
    .select({
      id: questionnaireVersion.id,
      title: questionnaireVersion.title,
      draftRevision: questionnaireVersion.draftRevision,
    })
    .from(questionnaireVersion)
    .where(and(eq(questionnaireVersion.questionnaireId, questionnaireId), eq(questionnaireVersion.status, "draft")))
    .for("update");
  return draft;
}

async function nextVersionNumber(tx: Transaction, questionnaireId: string): Promise<number> {
  const [row] = await tx
    .select({ next: sql<number>`coalesce(max(${questionnaireVersion.version}), 0) + 1` })
    .from(questionnaireVersion)
    .where(eq(questionnaireVersion.questionnaireId, questionnaireId));
  return Number(row?.next ?? 1);
}

export async function readDraftItems(tx: Transaction, draftVersionId: string): Promise<Item[]> {
  const rows = await tx
    .select({
      itemId: questionnaireItem.itemId,
      required: questionnaireItem.required,
      visibleWhen: questionnaireItem.visibleWhen,
      questionId: questionVersion.questionId,
      version: questionVersion.version,
      type: questionVersion.type,
      prompt: questionVersion.prompt,
      constraints: questionVersion.constraints,
    })
    .from(questionnaireItem)
    .innerJoin(
      questionVersion,
      and(
        eq(questionVersion.questionId, questionnaireItem.questionId),
        eq(questionVersion.version, questionnaireItem.questionVersion),
      ),
    )
    .where(eq(questionnaireItem.questionnaireVersionId, draftVersionId))
    .orderBy(asc(questionnaireItem.position));

  const options = await tx
    .select({
      questionId: questionVersionOption.questionId,
      version: questionVersionOption.version,
      optionId: questionVersionOption.optionId,
      label: questionVersionOption.label,
      freeform: questionVersionOption.freeform,
    })
    .from(questionVersionOption)
    .where(
      sql`(${questionVersionOption.questionId}, ${questionVersionOption.version}) IN (
        SELECT ${questionnaireItem.questionId}, ${questionnaireItem.questionVersion}
          FROM ${questionnaireItem}
         WHERE ${questionnaireItem.questionnaireVersionId} = ${draftVersionId})`,
    )
    .orderBy(asc(questionVersionOption.position));

  const optionsByQuestionVersion = new Map<string, StoredOption[]>();
  for (const option of options) {
    const key = `${option.questionId}:${option.version}`;
    optionsByQuestionVersion.set(key, [...(optionsByQuestionVersion.get(key) ?? []), option]);
  }

  return rows.map((row) => ({
    itemId: row.itemId,
    required: row.required,
    visibleWhen: row.visibleWhen as Predicate | null,
    question: storedQuestionToContent(row, optionsByQuestionVersion.get(`${row.questionId}:${row.version}`) ?? []),
  }));
}

async function archivedQuestionIds(tx: Transaction, items: readonly Item[]): Promise<Set<string>> {
  const questionIds = [...new Set(items.map((item) => item.question.questionId))];
  if (questionIds.length === 0) {
    return new Set();
  }
  const archived = await tx
    .select({ id: question.id })
    .from(question)
    .where(and(inArray(question.id, questionIds), isNotNull(question.archivedAt)));
  return new Set(archived.map((row) => row.id));
}

export async function draftForValidation(tx: Transaction, items: readonly Item[]): Promise<DraftForValidation> {
  return {
    items: items.map((item) => ({
      itemId: item.itemId,
      required: item.required,
      visibleWhen: item.visibleWhen,
      questionId: item.question.questionId,
      questionVersion: item.question.questionVersion,
    })),
    questions: items.map((item) => item.question),
    archivedQuestionIds: await archivedQuestionIds(tx, items),
  };
}

export async function publishDraft(executor: Executor, command: PublishDraftCommand): Promise<PublishDraftOutcome> {
  return executor.transaction(async (tx) => {
    if (!(await lockQuestionnaire(tx, command.questionnaireId))) {
      return { outcome: "questionnaire-not-found" };
    }
    const draft = await lockDraft(tx, command.questionnaireId);
    if (draft === undefined) {
      return { outcome: "no-draft" };
    }
    if (draft.draftRevision !== command.expectedDraftRevision) {
      return { outcome: "stale", draftRevision: draft.draftRevision };
    }

    const version = await nextVersionNumber(tx, command.questionnaireId);
    const definition: PublishedDefinition = {
      formatVersion: FORMAT_VERSION,
      questionnaireId: command.questionnaireId,
      version,
      title: draft.title,
      items: await readDraftItems(tx, draft.id),
    };

    const validation = validateDraft(await draftForValidation(tx, definition.items));
    if (!validation.valid) {
      return { outcome: "invalid", items: validation.items };
    }
    if (!Value.Check(PublishedDefinition, definition)) {
      throw new Error("serialized snapshot does not match the PublishedDefinition schema");
    }

    const promoted = await tx.execute<{ version: number }>(
      sql`SELECT definition.promote_draft(${draft.id}::uuid, ${JSON.stringify(definition)}::jsonb) AS version`,
    );
    if (promoted.rows[0]?.version !== version) {
      throw new Error("promote_draft assigned a different version than the snapshot names");
    }

    await recordAudit(tx, {
      action: "publish",
      questionnaireId: command.questionnaireId,
      questionnaireVersionId: draft.id,
      version,
      actorId: command.actorId,
      summary: { itemCount: definition.items.length, draftRevision: draft.draftRevision },
      traceId: command.traceId,
    });

    return { outcome: "published", questionnaireVersionId: draft.id, version, definition };
  });
}
