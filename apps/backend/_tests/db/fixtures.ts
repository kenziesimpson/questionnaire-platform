import type { QuestionInput } from "@qp/shared";
import { v4 as uuidv4, v7 as uuidv7 } from "uuid";
import type pg from "pg";
import type { Database } from "../../src/db/client.js";
import { publishDraft } from "../../src/db/definition/publish.js";
import { replaceDraft, createQuestionnaire } from "../../src/db/definition/questionnaires.js";
import { createQuestion } from "../../src/db/definition/questions.js";

const actor = { createdBy: "test", traceId: null };

export const aTextQuestion: QuestionInput = { type: "text", prompt: "Anything else?" };

export interface DraftFixture {
  readonly questionnaireId: string;
  readonly draftVersionId: string;
  readonly draftRevision: number;
  readonly questionId: string;
}

export async function aDraftWithOneItem(db: Database): Promise<DraftFixture> {
  const saved = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
  const created = await createQuestionnaire(db, { key: null, name: "Fixture", title: "Fixture", ...actor });
  const edited = await replaceDraft(db, {
    questionnaireId: created.questionnaireId,
    expectedDraftVersionId: created.draftVersionId,
    expectedDraftRevision: created.draftRevision,
    title: "Fixture",
    items: [{ itemId: "itm_01", required: true, visibleWhen: null, questionId: saved.questionId, questionVersion: 1 }],
    actorId: "test",
    traceId: null,
  });
  if (edited.outcome !== "saved") {
    throw new Error(`fixture draft was not saved: ${edited.outcome}`);
  }
  return {
    questionnaireId: created.questionnaireId,
    draftVersionId: created.draftVersionId,
    draftRevision: edited.draftRevision,
    questionId: saved.questionId,
  };
}

export interface PublishedFixture extends DraftFixture {
  readonly version: number;
}

export async function aPublishedQuestionnaire(db: Database): Promise<PublishedFixture> {
  const draft = await aDraftWithOneItem(db);
  const published = await publishDraft(db, {
    questionnaireId: draft.questionnaireId,
    expectedDraftVersionId: draft.draftVersionId,
    expectedDraftRevision: draft.draftRevision,
    actorId: "test",
    traceId: null,
  });
  if (published.outcome !== "published") {
    throw new Error(`fixture was not published: ${published.outcome}`);
  }
  return { ...draft, version: published.version };
}

export async function aSession(execution: pg.Client, published: PublishedFixture): Promise<string> {
  const sessionId = uuidv4();
  await execution.query(
    `INSERT INTO execution.session (id, questionnaire_id, questionnaire_version_id, version, status)
     VALUES ($1, $2, $3, $4, 'in_progress')`,
    [sessionId, published.questionnaireId, published.draftVersionId, published.version],
  );
  return sessionId;
}

export interface ResponseValues {
  readonly question_type: string;
  readonly text_value?: string | null;
  readonly number_value?: string | null;
  readonly number_unit?: string | null;
  readonly date_value?: string | null;
  readonly option_ids?: readonly (string | null)[] | null;
  readonly other_text?: string | null;
}

export function insertResponse(
  execution: pg.Client,
  published: PublishedFixture,
  sessionId: string,
  values: ResponseValues,
  createdAt: Date = new Date(),
): Promise<pg.QueryResult> {
  return execution.query(
    `INSERT INTO execution.response (id, created_at, session_id, questionnaire_version_id, item_id, question_id,
                                     question_version, question_type, text_value, number_value, number_unit,
                                     date_value, option_ids, other_text)
     VALUES ($1, $2, $3, $4, 'itm_01', $5, 1, $6, $7, $8, $9, $10, $11, $12)`,
    [
      uuidv7(),
      createdAt,
      sessionId,
      published.draftVersionId,
      published.questionId,
      values.question_type,
      values.text_value ?? null,
      values.number_value ?? null,
      values.number_unit ?? null,
      values.date_value ?? null,
      values.option_ids ?? null,
      values.other_text ?? null,
    ],
  );
}
