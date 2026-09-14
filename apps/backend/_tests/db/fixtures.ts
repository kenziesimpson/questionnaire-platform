import type { QuestionInput } from "@qp/shared";
import { v4 as uuidv4, v7 as uuidv7 } from "uuid";
import type pg from "pg";
import type { Database, Transaction } from "../../src/db/client.js";
import { publishDraft } from "../../src/db/definition/publish.js";
import { replaceDraft, createQuestionnaire } from "../../src/db/definition/questionnaires.js";
import { createQuestion } from "../../src/db/definition/questions.js";
import type { TestDatabase } from "./harness.js";

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
    precondition: { versionId: created.draftVersionId, draftRevision: created.draftRevision },
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
    precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
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

export const QUESTIONNAIRE_LOCK_STATEMENT = /from "definition"\."questionnaire" where "definition"\."questionnaire"\."id" = \$1 for update$/;

export async function theStatementWaitingOnALock(testDatabase: TestDatabase): Promise<string> {
  const client = await testDatabase.connect("definition");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ query: string }>(
      "SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    const [waiting, ...others] = result.rows;
    if (waiting !== undefined && others.length === 0) {
      return waiting.query;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("no single statement was seen waiting on a lock");
}

export async function whileHoldingALock(
  db: Database,
  holdLock: (tx: Transaction) => Promise<unknown>,
  whileHeld: () => Promise<void>,
): Promise<void> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalHeld: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    signalHeld = resolve;
  });
  const holder = db.transaction(async (tx) => {
    await holdLock(tx);
    signalHeld();
    await released;
  });
  await held;
  try {
    await whileHeld();
  } finally {
    release();
    await holder;
  }
}
