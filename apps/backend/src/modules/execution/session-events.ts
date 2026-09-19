import { annotateActiveSpan, emitDomainEvent, type Outcome } from "@qp/telemetry";
import type { SessionRow } from "../../db/execution/sessions.js";
import type { SessionFacts, SubmitOutcome } from "../../db/execution/submit.js";

function elapsedSecondsSince(startedAt: Date, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000));
}

function finished(facts: SessionFacts, outcome: Outcome): void {
  annotateActiveSpan({ ...facts, outcome });
  emitDomainEvent({ name: "session.submit_finished", ...facts, outcome });
}

export function reportSessionStarted(session: SessionRow): void {
  emitDomainEvent({
    name: "session.started",
    sessionId: session.id,
    questionnaireId: session.questionnaireId,
    questionnaireVersion: session.version,
  });
}

export function reportSessionResumed(session: SessionRow, now: Date): void {
  if (session.status !== "in_progress") return;
  emitDomainEvent({
    name: "session.resumed",
    sessionId: session.id,
    questionnaireId: session.questionnaireId,
    questionnaireVersion: session.version,
    elapsedSeconds: elapsedSecondsSince(session.startedAt, now),
  });
}

export function reportSubmit(submitted: SubmitOutcome): void {
  switch (submitted.outcome) {
    case "not-found":
      return;
    case "replayed":
      finished(submitted.facts, "accepted");
      return;
    case "already-submitted":
      finished(submitted.facts, "rejected_conflict");
      return;
    case "closed":
      emitDomainEvent({ name: "session.rejected_past_cutoff", ...submitted.facts });
      finished(submitted.facts, "rejected_conflict");
      return;
    case "invalid":
      for (const { itemId, questionId, code } of submitted.rejections) {
        emitDomainEvent({ name: "session.answer_rejected", sessionId: submitted.facts.sessionId, itemId, questionId, reason: code });
      }
      finished(submitted.facts, "rejected_validation");
      return;
    case "submitted":
      for (const { itemId, questionId, questionType } of submitted.answered) {
        emitDomainEvent({ name: "session.question_answered", sessionId: submitted.facts.sessionId, itemId, questionId, questionType });
      }
      for (const { itemId, questionId } of submitted.skipped) {
        emitDomainEvent({ name: "session.item_skipped", sessionId: submitted.facts.sessionId, itemId, questionId });
      }
      emitDomainEvent({
        name: "session.completed",
        sessionId: submitted.facts.sessionId,
        durationMs: submitted.durationMs,
        questionCount: submitted.answered.length,
      });
      finished(submitted.facts, "accepted");
      return;
  }
}
