import type { ResponseType, SessionStatus } from "@qp/shared";
import pg from "pg";

export interface SessionRecord {
  readonly sessionId: string;
  readonly questionnaireId: string;
  readonly questionnaireVersionId: string;
  readonly version: number;
  readonly status: SessionStatus;
  readonly startedAt: Date;
  readonly lastActivityAt: Date;
  readonly submittedAt: Date | null;
  readonly responseDigest: Buffer | null;
}

export interface ResponseRecord {
  readonly responseId: string;
  readonly createdAt: Date;
  readonly sessionId: string;
  readonly questionnaireVersionId: string;
  readonly questionnaireVersion: number;
  readonly itemId: string;
  readonly questionId: string;
  readonly questionVersion: number;
  readonly questionType: ResponseType;
  readonly textValue: string | null;
  readonly numberValue: string | null;
  readonly numberUnit: string | null;
  readonly dateValue: string | null;
  readonly optionIds: string[] | null;
  readonly otherText: string | null;
}

export interface QuestionnaireVersionRecord {
  readonly questionnaireVersionId: string;
  readonly version: number | null;
  readonly status: "draft" | "published";
  readonly title: string;
  readonly draftRevision: number;
  readonly publishedAt: Date | null;
}

export interface QuestionnaireRecord {
  readonly questionnaireId: string;
  readonly key: string | null;
  readonly name: string;
  readonly closesAt: Date | null;
  readonly currentVersion: number | null;
}

export interface AuditEventRecord {
  readonly action: string;
  readonly actorId: string | null;
  readonly questionnaireVersionId: string | null;
  readonly version: number | null;
  readonly occurredAt: Date;
}

const SESSION_COLUMNS = `
  s.id AS "sessionId",
  s.questionnaire_id AS "questionnaireId",
  s.questionnaire_version_id AS "questionnaireVersionId",
  s.version AS "version",
  s.status AS "status",
  s.started_at AS "startedAt",
  s.last_activity_at AS "lastActivityAt",
  s.submitted_at AS "submittedAt",
  s.response_digest AS "responseDigest"`;

const RESPONSE_COLUMNS = `
  r.id AS "responseId",
  r.created_at AS "createdAt",
  r.session_id AS "sessionId",
  r.questionnaire_version_id AS "questionnaireVersionId",
  qv.version AS "questionnaireVersion",
  r.item_id AS "itemId",
  r.question_id AS "questionId",
  r.question_version AS "questionVersion",
  r.question_type AS "questionType",
  r.text_value AS "textValue",
  r.number_value::text AS "numberValue",
  r.number_unit AS "numberUnit",
  r.date_value::text AS "dateValue",
  r.option_ids AS "optionIds",
  r.other_text AS "otherText"`;

export class StackDatabase {
  readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  }

  async query<Row extends pg.QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
    const result = await this.pool.query<Row>(text, [...values]);
    return result.rows;
  }

  async sessionsFor(questionnaireId: string): Promise<SessionRecord[]> {
    return this.query<SessionRecord>(
      `SELECT ${SESSION_COLUMNS} FROM execution.session s WHERE s.questionnaire_id = $1 ORDER BY s.started_at, s.id`,
      [questionnaireId],
    );
  }

  async session(sessionId: string): Promise<SessionRecord | undefined> {
    const [row] = await this.query<SessionRecord>(`SELECT ${SESSION_COLUMNS} FROM execution.session s WHERE s.id = $1`, [sessionId]);
    return row;
  }

  async responsesFor(sessionId: string): Promise<ResponseRecord[]> {
    return this.query<ResponseRecord>(
      `SELECT ${RESPONSE_COLUMNS}
         FROM execution.response r
         JOIN definition.questionnaire_version qv ON qv.id = r.questionnaire_version_id
        WHERE r.session_id = $1
        ORDER BY r.item_id`,
      [sessionId],
    );
  }

  async questionnaire(questionnaireId: string): Promise<QuestionnaireRecord | undefined> {
    const [row] = await this.query<QuestionnaireRecord>(
      `SELECT id AS "questionnaireId", key, name, closes_at AS "closesAt", current_version AS "currentVersion"
         FROM definition.questionnaire WHERE id = $1`,
      [questionnaireId],
    );
    return row;
  }

  async setClosesAt(questionnaireId: string, closesAt: Date | null): Promise<void> {
    const result = await this.pool.query("UPDATE definition.questionnaire SET closes_at = $2 WHERE id = $1", [questionnaireId, closesAt]);
    if (result.rowCount !== 1) throw new Error(`No questionnaire ${questionnaireId} to set closes_at on`);
  }

  async closeQuestionnaire(questionnaireId: string, closedFor: { minutes: number } = { minutes: 60 }): Promise<Date> {
    const closesAt = new Date(Date.now() - closedFor.minutes * 60_000);
    await this.setClosesAt(questionnaireId, closesAt);
    return closesAt;
  }

  async versionsOf(questionnaireId: string): Promise<QuestionnaireVersionRecord[]> {
    return this.query<QuestionnaireVersionRecord>(
      `SELECT id AS "questionnaireVersionId", version, status, title, draft_revision AS "draftRevision", published_at AS "publishedAt"
         FROM definition.questionnaire_version
        WHERE questionnaire_id = $1
        ORDER BY version NULLS LAST`,
      [questionnaireId],
    );
  }

  async publishedVersionCount(questionnaireId: string): Promise<number> {
    return (await this.versionsOf(questionnaireId)).filter((version) => version.status === "published").length;
  }

  async questionVersionCount(questionId: string): Promise<number> {
    const [row] = await this.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM definition.question_version WHERE question_id = $1`,
      [questionId],
    );
    return row?.count ?? 0;
  }

  async auditEventsFor(questionnaireId: string): Promise<AuditEventRecord[]> {
    return this.query<AuditEventRecord>(
      `SELECT action, actor_id AS "actorId", questionnaire_version_id AS "questionnaireVersionId", version, occurred_at AS "occurredAt"
         FROM audit.event
        WHERE questionnaire_id = $1
        ORDER BY occurred_at, id`,
      [questionnaireId],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
