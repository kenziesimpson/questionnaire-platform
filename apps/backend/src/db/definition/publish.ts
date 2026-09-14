import { FORMAT_VERSION, PublishedDefinition, validateDraft, type DraftItemCode, type ItemError } from "@qp/shared";
import { and, eq, max, sql } from "drizzle-orm";
import { Value } from "typebox/value";
import { recordAudit } from "../audit.js";
import { isCurrentDraft, type DraftPrecondition } from "./draft-precondition.js";
import type { Executor, Transaction } from "../client.js";
import { questionnaire, questionnaireVersion } from "../schema.js";
import { draftForValidation, itemsWithQuestionContent, readDraftContents } from "./draft-contents.js";

export interface PublishDraftCommand {
  readonly questionnaireId: string;
  readonly precondition: DraftPrecondition;
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
    .select({ latest: max(questionnaireVersion.version) })
    .from(questionnaireVersion)
    .where(eq(questionnaireVersion.questionnaireId, questionnaireId));
  return (row?.latest ?? 0) + 1;
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
    if (!isCurrentDraft(command.precondition, { versionId: draft.id, draftRevision: draft.draftRevision })) {
      return { outcome: "stale", draftRevision: draft.draftRevision };
    }

    const version = await nextVersionNumber(tx, command.questionnaireId);
    const definition: PublishedDefinition = {
      formatVersion: FORMAT_VERSION,
      questionnaireId: command.questionnaireId,
      version,
      title: draft.title,
      items: itemsWithQuestionContent(await readDraftContents(tx, draft.id)),
    };

    const validation = validateDraft(await draftForValidation(tx, definition.items));
    if (!validation.valid) {
      return { outcome: "invalid", items: validation.items };
    }
    if (!Value.Check(PublishedDefinition, definition)) {
      throw new Error("serialized snapshot does not match the PublishedDefinition schema");
    }

    const promoted = await tx.execute<{ version: number }>(
      // eslint-disable-next-line no-restricted-syntax -- definition.promote_draft is a SECURITY DEFINER function (Decisions Log #51); the query builder cannot call a Postgres function
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
