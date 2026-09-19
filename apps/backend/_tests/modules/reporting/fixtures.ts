import { reportingApi, sensitive, type ClientAnswers } from "@qp/shared";
import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import type { Database } from "../../../src/db/client.js";
import { PublishedDefinitions } from "../../../src/db/execution/published-definitions.js";
import { startSession } from "../../../src/db/execution/sessions.js";
import { submitSession } from "../../../src/db/execution/submit.js";
import type { PublishedFixture } from "../../db/fixtures.js";

export function reportingUrl(path: string): string {
  return `${reportingApi.REPORTING_PREFIX}${path}`;
}

export async function startedSessionId(
  execution: Database,
  definitions: PublishedDefinitions,
  questionnaireId: string,
  now: Date,
): Promise<string> {
  const started = await startSession(execution, definitions, questionnaireId, now);
  if (started.outcome !== "found") {
    throw new Error(`fixture session did not start with outcome ${started.outcome}`);
  }
  return started.session.id;
}

export async function submitFixtureAnswers(
  execution: Database,
  definitions: PublishedDefinitions,
  sessionId: string,
  answers: ClientAnswers,
  now: Date,
): Promise<void> {
  const submitted = await submitSession(execution, definitions, { sessionId, answers: sensitive(answers), now });
  if (submitted.outcome !== "submitted" && submitted.outcome !== "replayed") {
    throw new Error(`fixture session did not submit: ${JSON.stringify(submitted)}`);
  }
}

export function aSessionStartedAt(
  execution: pg.Client,
  published: PublishedFixture,
  startedAt: Date,
  status: "in_progress" | "submitted" = "in_progress",
): Promise<string> {
  const sessionId = uuidv4();
  const submittedAt = status === "submitted" ? startedAt : null;
  return execution
    .query(
      `INSERT INTO execution.session
         (id, questionnaire_id, questionnaire_version_id, version, status, started_at, last_activity_at, submitted_at, response_digest)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)`,
      [
        sessionId,
        published.questionnaireId,
        published.draftVersionId,
        published.version,
        status,
        startedAt,
        submittedAt,
        status === "submitted" ? Buffer.from("test-digest") : null,
      ],
    )
    .then(() => sessionId);
}

export function listSessionsUrl(questionnaireId: string, query: Record<string, string> = {}): string {
  const search = new URLSearchParams(query).toString();
  return reportingUrl(`/questionnaires/${questionnaireId}/responses${search === "" ? "" : `?${search}`}`);
}

export function sessionDetailUrl(questionnaireId: string, sessionId: string): string {
  return reportingUrl(`/questionnaires/${questionnaireId}/responses/${sessionId}`);
}
