import { annotateActiveSpan, emitDomainEvent, MAX_FINDINGS, type Outcome } from "@qp/telemetry";
import type { ReplaceDraftOutcome } from "../../db/definition/drafts.js";
import type { PublishDraftOutcome } from "../../db/definition/publish.js";
import type { SetClosesAtOutcome } from "../../db/definition/questionnaires.js";

function publishFinished(questionnaireId: string, outcome: Outcome): void {
  annotateActiveSpan({ questionnaireId, outcome });
  emitDomainEvent({ name: "questionnaire.publish_finished", questionnaireId, outcome });
}

export function reportQuestionnaireCreated(questionnaireId: string): void {
  annotateActiveSpan({ questionnaireId });
  emitDomainEvent({ name: "questionnaire.created", questionnaireId });
}

export function reportDraftSaved(questionnaireId: string, saved: ReplaceDraftOutcome): void {
  if (saved.outcome === "stale") {
    emitDomainEvent({ name: "questionnaire.draft_conflict", questionnaireId });
  }
}

export function reportPublish(questionnaireId: string, published: PublishDraftOutcome): void {
  switch (published.outcome) {
    case "published":
      annotateActiveSpan({ questionnaireVersion: published.summary.version });
      emitDomainEvent({ name: "questionnaire.published", questionnaireId, questionnaireVersion: published.summary.version });
      publishFinished(questionnaireId, "accepted");
      return;
    case "invalid":
      for (const { itemId, code } of published.items.slice(0, MAX_FINDINGS)) {
        emitDomainEvent({ name: "questionnaire.publish_rejected", questionnaireId, itemId, problemCode: code });
      }
      publishFinished(questionnaireId, "rejected_validation");
      return;
    case "stale":
      emitDomainEvent({ name: "questionnaire.draft_conflict", questionnaireId });
      publishFinished(questionnaireId, "rejected_conflict");
      return;
    case "no-draft":
    case "questionnaire-not-found":
      return;
  }
}

export function reportPublishFailed(questionnaireId: string): void {
  publishFinished(questionnaireId, "failed");
}

export function reportClosesAtSet(questionnaireId: string, closesAt: Date | null, updated: SetClosesAtOutcome): void {
  if (updated.outcome === "updated" && closesAt !== null) {
    emitDomainEvent({ name: "questionnaire.retired", questionnaireId });
  }
}
