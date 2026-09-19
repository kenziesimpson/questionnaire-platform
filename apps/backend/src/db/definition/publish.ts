import {
  FORMAT_VERSION,
  PublishedDefinition,
  draftForValidation,
  validateDraft,
  type DraftPrecondition,
  type VersionSummary,
} from "@qp/shared";
import { eq, max, sql } from "drizzle-orm";
import { Value } from "typebox/value";
import { recordAudit } from "../audit.js";
import type { Executor, Transaction } from "../client.js";
import { mustExist } from "../errors.js";
import { InvariantViolation } from "../../invariant.js";
import { questionnaireVersion } from "../schema.js";
import { itemsWithQuestionContent, readDraftContents, type DraftInvalidItem } from "./draft-contents.js";
import { withLockedQuestionnaire, type QuestionnaireNotFound } from "./questionnaire-rows.js";
import { withCurrentDraft, type DraftNotWritable } from "./questionnaire-version-rows.js";
import { readVersionSummary } from "./versions.js";

export interface PublishDraftCommand {
  readonly questionnaireId: string;
  readonly precondition: DraftPrecondition;
  readonly actorId: string | null;
  readonly traceId: string | null;
}

export type PublishDraftOutcome =
  | { readonly outcome: "published"; readonly summary: VersionSummary }
  | QuestionnaireNotFound
  | DraftNotWritable
  | { readonly outcome: "invalid"; readonly items: readonly DraftInvalidItem[] };

async function nextVersionNumber(tx: Transaction, questionnaireId: string): Promise<number> {
  const [row] = await tx
    .select({ latest: max(questionnaireVersion.version) })
    .from(questionnaireVersion)
    .where(eq(questionnaireVersion.questionnaireId, questionnaireId));
  return (row?.latest ?? 0) + 1;
}

export async function publishDraft(executor: Executor, command: PublishDraftCommand): Promise<PublishDraftOutcome> {
  return withLockedQuestionnaire(executor, command.questionnaireId, async (tx): Promise<PublishDraftOutcome> =>
    withCurrentDraft(tx, command, async (draft): Promise<PublishDraftOutcome> => {
      const version = await nextVersionNumber(tx, command.questionnaireId);
      const definition: PublishedDefinition = {
        formatVersion: FORMAT_VERSION,
        questionnaireId: command.questionnaireId,
        version,
        title: draft.title,
        items: itemsWithQuestionContent(await readDraftContents(tx, draft.id)),
      };

      const validation = validateDraft(draftForValidation(definition.items));
      if (!validation.valid) {
        return { outcome: "invalid", items: validation.items };
      }
      if (!Value.Check(PublishedDefinition, definition)) {
        throw InvariantViolation.of("snapshot.fails-published-schema", { questionnaireId: command.questionnaireId, questionnaireVersion: version });
      }

      const promoted = await tx.execute<{ version: number }>(
        // eslint-disable-next-line no-restricted-syntax -- definition.promote_draft is a SECURITY DEFINER function (Decisions Log #51); the query builder cannot call a Postgres function
        sql`SELECT definition.promote_draft(${draft.id}::uuid, ${JSON.stringify(definition)}::jsonb) AS version`,
      );
      if (promoted.rows[0]?.version !== version) {
        throw InvariantViolation.of("promote-draft.version-mismatch", { questionnaireId: command.questionnaireId, questionnaireVersion: version });
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

      const summary = mustExist(await readVersionSummary(tx, command.questionnaireId, version), "version.unreadable-after-publish", {
        questionnaireId: command.questionnaireId,
        questionnaireVersion: version,
      });
      return { outcome: "published", summary };
    }),
  );
}
