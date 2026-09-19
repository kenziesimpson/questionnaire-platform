import type { PublishedDefinition, Receipt, Session } from "@qp/shared";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { InvariantViolation } from "../../invariant.js";
import type { Executor } from "../client.js";
import { questionnaire, session } from "../schema.js";
import type { PublishedDefinitions } from "./published-definitions.js";

export interface SessionRow {
  readonly id: string;
  readonly questionnaireId: string;
  readonly questionnaireVersionId: string;
  readonly version: number;
  readonly status: "in_progress" | "submitted";
  readonly startedAt: Date;
  readonly submittedAt: Date | null;
}

export const sessionColumns = {
  id: session.id,
  questionnaireId: session.questionnaireId,
  questionnaireVersionId: session.questionnaireVersionId,
  version: session.version,
  status: session.status,
  startedAt: session.startedAt,
  submittedAt: session.submittedAt,
};

export function isClosed(closesAt: Date | null, now: Date): boolean {
  return closesAt !== null && closesAt.getTime() <= now.getTime();
}

export function sessionView(row: SessionRow): Session {
  return {
    sessionId: row.id,
    questionnaireId: row.questionnaireId,
    version: row.version,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    submittedAt: row.submittedAt === null ? null : row.submittedAt.toISOString(),
  };
}

export function receiptFor(row: SessionRow, submittedAt: Date): Receipt {
  return {
    sessionId: row.id,
    questionnaireId: row.questionnaireId,
    version: row.version,
    submittedAt: submittedAt.toISOString(),
  };
}

export type SessionWithDefinitionOutcome =
  | { readonly outcome: "found"; readonly session: SessionRow; readonly definition: PublishedDefinition }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "closed" };

export async function startSession(
  executor: Executor,
  definitions: PublishedDefinitions,
  questionnaireId: string,
  now: Date,
): Promise<SessionWithDefinitionOutcome> {
  const [target] = await executor
    .select({
      currentVersionId: questionnaire.currentVersionId,
      currentVersion: questionnaire.currentVersion,
      closesAt: questionnaire.closesAt,
    })
    .from(questionnaire)
    .where(eq(questionnaire.id, questionnaireId));
  if (target === undefined || target.currentVersionId === null || target.currentVersion === null) {
    return { outcome: "not-found" };
  }
  if (isClosed(target.closesAt, now)) {
    return { outcome: "closed" };
  }

  const definition = await definitions.pinned(executor, target.currentVersionId);
  const [started] = await executor
    .insert(session)
    .values({
      id: uuidv4(),
      questionnaireId,
      questionnaireVersionId: target.currentVersionId,
      version: target.currentVersion,
      status: "in_progress",
      startedAt: now,
      lastActivityAt: now,
    })
    .returning(sessionColumns);
  if (started === undefined) {
    throw InvariantViolation.of("session.insert-returned-no-row", { questionnaireId, questionnaireVersion: target.currentVersion });
  }
  return { outcome: "found", session: started, definition };
}

export async function resumeSession(
  executor: Executor,
  definitions: PublishedDefinitions,
  sessionId: string,
  now: Date,
): Promise<SessionWithDefinitionOutcome> {
  const [found] = await executor
    .select({ ...sessionColumns, closesAt: questionnaire.closesAt })
    .from(session)
    .innerJoin(questionnaire, eq(questionnaire.id, session.questionnaireId))
    .where(eq(session.id, sessionId));
  if (found === undefined) {
    return { outcome: "not-found" };
  }
  if (found.status === "in_progress" && isClosed(found.closesAt, now)) {
    return { outcome: "closed" };
  }
  const definition = await definitions.pinned(executor, found.questionnaireVersionId);
  return { outcome: "found", session: found, definition };
}
