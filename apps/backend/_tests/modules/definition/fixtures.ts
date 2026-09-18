import { definitionApi, formatDraftEtag, type DraftItem } from "@qp/shared";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import type { Database } from "../../../src/db/client.js";
import { replaceDraft } from "../../../src/db/definition/drafts.js";
import { createQuestion } from "../../../src/db/definition/questions.js";
import { actor, aTextQuestion, type TestDatabase } from "../../db/fixtures.js";

export function definitionUrl(path: string): string {
  return `${definitionApi.DEFINITION_PREFIX}${path}`;
}

export interface OpenDraft {
  readonly draftVersionId: string;
  readonly draftRevision: number;
}

export async function createNextDraftDirectly(testDatabase: TestDatabase, questionnaireId: string): Promise<OpenDraft> {
  const draftVersionId = uuidv7();
  const client = await testDatabase.connect("definition");
  await client.query(
    `INSERT INTO definition.questionnaire_version (id, questionnaire_id, status, title, created_by)
     VALUES ($1, $2, 'draft', 'Fixture', 'test')`,
    [draftVersionId, questionnaireId],
  );
  return { draftVersionId, draftRevision: 0 };
}

export function publish(app: FastifyInstance, questionnaireId: string, draft: OpenDraft) {
  return app.inject({
    method: "POST",
    url: definitionUrl(`/questionnaires/${questionnaireId}/publish`),
    headers: { "if-match": formatDraftEtag(draft.draftVersionId, draft.draftRevision) },
  });
}

export async function saveDraft(db: Database, questionnaireId: string, draft: OpenDraft, items: DraftItem[]): Promise<OpenDraft> {
  const saved = await replaceDraft(db, {
    questionnaireId,
    precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
    title: "Fixture",
    items,
    actorId: "test",
    traceId: null,
  });
  if (saved.outcome !== "saved") {
    throw new Error(`test draft was not saved: ${saved.outcome}`);
  }
  return { draftVersionId: saved.draftVersionId, draftRevision: saved.draftRevision };
}

export async function aSecondItem(db: Database): Promise<DraftItem> {
  const saved = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
  return { itemId: "itm_02", required: false, visibleWhen: null, questionId: saved.questionId, questionVersion: 1 };
}

export async function storedSnapshotText(testDatabase: TestDatabase, questionnaireId: string, version: number): Promise<string> {
  const client = await testDatabase.connect("definition");
  const result = await client.query<{ snapshot: string }>(
    `SELECT snapshot::text AS snapshot FROM definition.questionnaire_version WHERE questionnaire_id = $1 AND version = $2`,
    [questionnaireId, version],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`version ${version} is not stored`);
  }
  return row.snapshot;
}
