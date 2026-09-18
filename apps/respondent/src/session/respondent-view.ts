import type { PublishedDefinition, Receipt } from "@qp/shared";
import type { SubmissionRejection } from "../answers/submission-rejection.ts";
import type { StoredPartials } from "../storage/partials.ts";
import { hasAnyAnswer, isRetryable } from "./failure.ts";
import type { FailedState, Failure, FormContext, RespondentState } from "./respondent-state.ts";

export interface SubmitFailureView {
  readonly attempt: number;
  readonly retryable: boolean;
}

export type RespondentView =
  | { readonly kind: "loading" }
  | { readonly kind: "notFound" }
  | { readonly kind: "closed" }
  | { readonly kind: "entryFailed" }
  | { readonly kind: "loadFailed"; readonly attempt: number; readonly retrying: boolean }
  | {
      readonly kind: "savedAnswersResumeFailed";
      readonly attempt: number;
      readonly retrying: boolean;
      readonly startingNewSession: boolean;
    }
  | { readonly kind: "recordedReceiptFailed"; readonly attempt: number; readonly retrying: boolean }
  | {
      readonly kind: "questionnaire";
      readonly form: FormContext;
      readonly submitting: boolean;
      readonly submitFailure: SubmitFailureView | null;
      readonly rejection: SubmissionRejection | null;
    }
  | { readonly kind: "receipt"; readonly receipt: Receipt; readonly definition: PublishedDefinition; readonly alreadySubmitted: boolean };

function startOrLoadFailedView(failure: Failure, retrying: boolean): RespondentView {
  return isRetryable(failure.reason) ? { kind: "loadFailed", attempt: failure.attempt, retrying } : { kind: "entryFailed" };
}

function resumeFailedView(failure: Failure, stored: StoredPartials, retrying: boolean, startingNewSession: boolean): RespondentView {
  if (!isRetryable(failure.reason)) return { kind: "entryFailed" };
  if (!hasAnyAnswer(stored.answers)) return startOrLoadFailedView(failure, retrying);
  return { kind: "savedAnswersResumeFailed", attempt: failure.attempt, retrying, startingNewSession };
}

function recordedReceiptFailedView(failure: Failure, retrying: boolean): RespondentView {
  return isRetryable(failure.reason) ? { kind: "recordedReceiptFailed", attempt: failure.attempt, retrying } : { kind: "entryFailed" };
}

function questionnaireView(
  form: FormContext,
  submitting: boolean,
  failure: Failure | null,
  rejection: SubmissionRejection | null,
): RespondentView {
  const { session, definition, restoredAnswers, restored } = form;
  const submitFailure: SubmitFailureView | null = failure === null ? null : { attempt: failure.attempt, retryable: isRetryable(failure.reason) };
  return { kind: "questionnaire", form: { session, definition, restoredAnswers, restored }, submitting, submitFailure, rejection };
}

function failedView(state: FailedState): RespondentView {
  switch (state.step) {
    case "starting":
      return startOrLoadFailedView(state.failure, false);
    case "resuming":
      return resumeFailedView(state.failure, state.stored, false, false);
    case "submitting":
      return questionnaireView(state, false, state.failure, null);
    case "fetchingRecordedReceipt":
      return recordedReceiptFailedView(state.failure, false);
  }
}

export function viewOf(state: RespondentState): RespondentView {
  switch (state.name) {
    case "entering":
      return { kind: "loading" };
    case "starting":
      return state.previousFailure === null ? { kind: "loading" } : startOrLoadFailedView(state.previousFailure, true);
    case "resuming":
      return state.previousFailure === null ? { kind: "loading" } : resumeFailedView(state.previousFailure, state.stored, true, false);
    case "startingNewSession":
      return resumeFailedView(state.previousFailure, state.stored, false, true);
    case "ready":
      return questionnaireView(state, false, null, state.rejection);
    case "submitting":
      return questionnaireView(state, true, state.previousFailure, null);
    case "fetchingRecordedReceipt":
      return state.previousFailure === null ? questionnaireView(state, true, null, null) : recordedReceiptFailedView(state.previousFailure, true);
    case "failed":
      return failedView(state);
    case "done":
      return { kind: "receipt", receipt: state.receipt, definition: state.definition, alreadySubmitted: state.alreadySubmitted };
    case "closed":
      return { kind: "closed" };
    case "notFound":
      return { kind: "notFound" };
  }
}
