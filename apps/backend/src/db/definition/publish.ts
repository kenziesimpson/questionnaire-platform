import { FORMAT_VERSION, PublishedDefinition, type Item, type Predicate } from "@qp/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { Value } from "typebox/value";
import { recordAudit } from "../audit.js";
import type { Executor, Transaction } from "../client.js";
import {
  questionnaire,
  questionnaireItem,
  questionnaireVersion,
  questionVersion,
  questionVersionOption,
  versionQuestionIndex,
} from "../schema.js";
import { storedQuestionToContent, type StoredOption } from "./question-content.js";

export type PublishRules<Failure> = (definition: PublishedDefinition) => readonly Failure[];

export interface PublishDraftCommand<Failure> {
  readonly questionnaireId: string;
  readonly expectedDraftRevision: number;
  readonly rules: PublishRules<Failure>;
  readonly actorId: string | null;
  readonly traceId: string | null;
}

export type PublishDraftOutcome<Failure> =
  | {
      readonly outcome: "published";
      readonly questionnaireVersionId: string;
      readonly version: number;
      readonly definition: PublishedDefinition;
    }
  | { readonly outcome: "questionnaire-not-found" }
  | { readonly outcome: "no-draft" }
  | { readonly outcome: "stale"; readonly draftRevision: number }
  | { readonly outcome: "invalid"; readonly failures: readonly Failure[] };

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

async function readDraftItems(tx: Transaction, draftVersionId: string): Promise<Item[]> {
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

export async function publishDraft<Failure>(
  executor: Executor,
  command: PublishDraftCommand<Failure>,
): Promise<PublishDraftOutcome<Failure>> {
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

    if (!Value.Check(PublishedDefinition, definition)) {
      throw new Error("serialized snapshot does not match the PublishedDefinition schema");
    }
    const failures = command.rules(definition);
    if (failures.length > 0) {
      return { outcome: "invalid", failures };
    }

    const pinned = new Map(
      definition.items.map((item) => [
        `${item.question.questionId}:${item.question.questionVersion}`,
        { questionId: item.question.questionId, questionVersion: item.question.questionVersion },
      ]),
    );
    if (pinned.size > 0) {
      await tx
        .insert(versionQuestionIndex)
        .values([...pinned.values()].map((entry) => ({ questionnaireVersionId: draft.id, ...entry })));
    }

    const promoted = await tx
      .update(questionnaireVersion)
      .set({
        status: "published",
        version,
        snapshot: definition,
        formatVersion: FORMAT_VERSION,
        publishedAt: sql`now()`,
      })
      .where(and(eq(questionnaireVersion.id, draft.id), eq(questionnaireVersion.status, "draft")))
      .returning({ id: questionnaireVersion.id });
    if (promoted.length !== 1) {
      throw new Error("draft was promoted by another transaction despite the questionnaire lock");
    }

    await tx
      .update(questionnaire)
      .set({ currentVersionId: draft.id, currentVersion: version })
      .where(eq(questionnaire.id, command.questionnaireId));

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
