import type { ClientAnswers, PublishedDefinition, Receipt, Session } from "@qp/shared";
import { withoutItemError, type SubmissionRejection } from "../answers/submission-rejection";
import type { ExecutionProblemSlug } from "../api/problems";
import type { StoredPartials } from "../storage/partials";
import { hasAnyAnswer, isRetryable } from "./failure";

export interface FormContext {
  readonly session: Session;
  readonly definition: PublishedDefinition;
  readonly restoredAnswers: ClientAnswers;
  readonly restored: boolean;
}

export type FailureReason =
  | { readonly kind: "problem"; readonly slug: ExecutionProblemSlug }
  | { readonly kind: "network-error" }
  | { readonly kind: "unexpected-response"; readonly status: number };

export interface Failure {
  readonly reason: FailureReason;
  readonly attempt: number;
}

interface Attempt {
  readonly previousFailure: Failure | null;
}

export type FailedState =
  | { readonly name: "failed"; readonly step: "starting"; readonly carriedAnswers: ClientAnswers; readonly failure: Failure }
  | { readonly name: "failed"; readonly step: "resuming"; readonly stored: StoredPartials; readonly failure: Failure }
  | ({ readonly name: "failed"; readonly step: "submitting"; readonly failure: Failure } & FormContext)
  | ({ readonly name: "failed"; readonly step: "fetchingRecordedReceipt"; readonly failure: Failure } & FormContext);

export type RespondentState =
  | { readonly name: "entering" }
  | ({ readonly name: "resuming"; readonly stored: StoredPartials } & Attempt)
  | ({ readonly name: "starting"; readonly carriedAnswers: ClientAnswers } & Attempt)
  | { readonly name: "startingNewSession"; readonly stored: StoredPartials; readonly previousFailure: Failure }
  | ({ readonly name: "ready"; readonly rejection: SubmissionRejection | null } & FormContext)
  | ({ readonly name: "submitting" } & FormContext & Attempt)
  | ({ readonly name: "fetchingRecordedReceipt" } & FormContext & Attempt)
  | { readonly name: "done"; readonly receipt: Receipt; readonly definition: PublishedDefinition; readonly alreadySubmitted: boolean }
  | { readonly name: "closed" }
  | { readonly name: "notFound" }
  | FailedState;

export type RespondentEvent =
  | { readonly type: "storedSessionFound"; readonly stored: StoredPartials }
  | { readonly type: "noStoredSession" }
  | { readonly type: "sessionResumed"; readonly session: Session; readonly definition: PublishedDefinition }
  | { readonly type: "submittedSessionResumed"; readonly receipt: Receipt; readonly definition: PublishedDefinition }
  | { readonly type: "storedSessionStale" }
  | { readonly type: "sessionStarted"; readonly session: Session; readonly definition: PublishedDefinition }
  | { readonly type: "questionnaireClosed" }
  | { readonly type: "questionnaireNotFound" }
  | { readonly type: "requestFailed"; readonly reason: FailureReason }
  | { readonly type: "retryRequested" }
  | { readonly type: "newSessionRequested" }
  | { readonly type: "submitRequested" }
  | { readonly type: "submitAccepted"; readonly receipt: Receipt }
  | { readonly type: "submissionRejected"; readonly rejection: SubmissionRejection }
  | { readonly type: "answerChanged"; readonly itemId: string }
  | { readonly type: "alreadySubmitted" }
  | { readonly type: "recordedReceiptFetched"; readonly receipt: Receipt; readonly definition: PublishedDefinition };

export const INITIAL_STATE: RespondentState = { name: "entering" };

function contextOf({ session, definition, restoredAnswers, restored }: FormContext): FormContext {
  return { session, definition, restoredAnswers, restored };
}

function failureAfter({ previousFailure }: Attempt, reason: FailureReason): Failure {
  return { reason, attempt: (previousFailure?.attempt ?? 0) + 1 };
}

export function formContextOf(state: RespondentState): FormContext | null {
  switch (state.name) {
    case "ready":
    case "submitting":
    case "fetchingRecordedReceipt":
      return state;
    case "failed":
      return state.step === "submitting" ? state : null;
    case "entering":
    case "resuming":
    case "starting":
    case "startingNewSession":
    case "done":
    case "closed":
    case "notFound":
      return null;
  }
}

function fromEntering(state: RespondentState, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "storedSessionFound":
      return { name: "resuming", stored: event.stored, previousFailure: null };
    case "noStoredSession":
      return { name: "starting", carriedAnswers: {}, previousFailure: null };
    case "sessionResumed":
    case "submittedSessionResumed":
    case "storedSessionStale":
    case "sessionStarted":
    case "questionnaireClosed":
    case "questionnaireNotFound":
    case "requestFailed":
    case "retryRequested":
    case "newSessionRequested":
    case "submitRequested":
    case "submitAccepted":
    case "submissionRejected":
    case "answerChanged":
    case "alreadySubmitted":
    case "recordedReceiptFetched":
      return state;
  }
}

function fromResuming(state: Extract<RespondentState, { name: "resuming" }>, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "sessionResumed": {
      const { answers } = state.stored;
      return {
        name: "ready",
        session: event.session,
        definition: event.definition,
        restoredAnswers: answers,
        restored: hasAnyAnswer(answers),
        rejection: null,
      };
    }
    case "submittedSessionResumed":
      return { name: "done", receipt: event.receipt, definition: event.definition, alreadySubmitted: false };
    case "storedSessionStale":
      return { name: "starting", carriedAnswers: {}, previousFailure: state.previousFailure };
    case "questionnaireClosed":
      return { name: "closed" };
    case "requestFailed":
      return { name: "failed", step: "resuming", stored: state.stored, failure: failureAfter(state, event.reason) };
    case "storedSessionFound":
    case "noStoredSession":
    case "sessionStarted":
    case "questionnaireNotFound":
    case "retryRequested":
    case "newSessionRequested":
    case "submitRequested":
    case "submitAccepted":
    case "submissionRejected":
    case "answerChanged":
    case "alreadySubmitted":
    case "recordedReceiptFetched":
      return state;
  }
}

function fromStarting(
  state: Extract<RespondentState, { name: "starting" | "startingNewSession" }>,
  carriedAnswers: ClientAnswers,
  event: RespondentEvent,
): RespondentState {
  switch (event.type) {
    case "sessionStarted":
      return {
        name: "ready",
        session: event.session,
        definition: event.definition,
        restoredAnswers: carriedAnswers,
        restored: hasAnyAnswer(carriedAnswers),
        rejection: null,
      };
    case "questionnaireClosed":
      return { name: "closed" };
    case "questionnaireNotFound":
      return { name: "notFound" };
    case "requestFailed":
      return { name: "failed", step: "starting", carriedAnswers, failure: failureAfter(state, event.reason) };
    case "storedSessionFound":
    case "noStoredSession":
    case "sessionResumed":
    case "submittedSessionResumed":
    case "storedSessionStale":
    case "retryRequested":
    case "newSessionRequested":
    case "submitRequested":
    case "submitAccepted":
    case "submissionRejected":
    case "answerChanged":
    case "alreadySubmitted":
    case "recordedReceiptFetched":
      return state;
  }
}

function fromReady(state: Extract<RespondentState, { name: "ready" }>, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "submitRequested":
      return { ...contextOf(state), name: "submitting", previousFailure: null };
    case "answerChanged": {
      const rejection = state.rejection === null ? null : withoutItemError(state.rejection, event.itemId);
      return rejection === state.rejection ? state : { ...state, rejection };
    }
    case "storedSessionFound":
    case "noStoredSession":
    case "sessionResumed":
    case "submittedSessionResumed":
    case "storedSessionStale":
    case "sessionStarted":
    case "questionnaireClosed":
    case "questionnaireNotFound":
    case "requestFailed":
    case "retryRequested":
    case "newSessionRequested":
    case "submitAccepted":
    case "submissionRejected":
    case "alreadySubmitted":
    case "recordedReceiptFetched":
      return state;
  }
}

function retried(state: FailedState): RespondentState {
  const previousFailure = state.failure;
  switch (state.step) {
    case "starting":
      return { name: "starting", carriedAnswers: state.carriedAnswers, previousFailure };
    case "resuming":
      return { name: "resuming", stored: state.stored, previousFailure };
    case "submitting":
      return { ...contextOf(state), name: "submitting", previousFailure };
    case "fetchingRecordedReceipt":
      return { ...contextOf(state), name: "fetchingRecordedReceipt", previousFailure };
  }
}

function fromFailed(state: FailedState, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "submitRequested":
      return state.step === "submitting" ? retried(state) : state;
    case "retryRequested":
      return state.step !== "submitting" && isRetryable(state.failure.reason) ? retried(state) : state;
    case "newSessionRequested":
      return state.step === "resuming" && isRetryable(state.failure.reason) && hasAnyAnswer(state.stored.answers)
        ? { name: "startingNewSession", stored: state.stored, previousFailure: state.failure }
        : state;
    case "storedSessionFound":
    case "noStoredSession":
    case "sessionResumed":
    case "submittedSessionResumed":
    case "storedSessionStale":
    case "sessionStarted":
    case "questionnaireClosed":
    case "questionnaireNotFound":
    case "requestFailed":
    case "submitAccepted":
    case "submissionRejected":
    case "answerChanged":
    case "alreadySubmitted":
    case "recordedReceiptFetched":
      return state;
  }
}

function fromSubmitting(state: Extract<RespondentState, { name: "submitting" }>, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "submitAccepted":
      return { name: "done", receipt: event.receipt, definition: state.definition, alreadySubmitted: false };
    case "submissionRejected":
      return { ...contextOf(state), name: "ready", rejection: event.rejection };
    case "alreadySubmitted":
      return { ...contextOf(state), name: "fetchingRecordedReceipt", previousFailure: null };
    case "questionnaireClosed":
      return { name: "closed" };
    case "requestFailed":
      return { ...contextOf(state), name: "failed", step: "submitting", failure: failureAfter(state, event.reason) };
    case "storedSessionFound":
    case "noStoredSession":
    case "sessionResumed":
    case "submittedSessionResumed":
    case "storedSessionStale":
    case "sessionStarted":
    case "questionnaireNotFound":
    case "retryRequested":
    case "newSessionRequested":
    case "submitRequested":
    case "answerChanged":
    case "recordedReceiptFetched":
      return state;
  }
}

function fromFetchingRecordedReceipt(state: Extract<RespondentState, { name: "fetchingRecordedReceipt" }>, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "recordedReceiptFetched":
      return { name: "done", receipt: event.receipt, definition: event.definition, alreadySubmitted: true };
    case "requestFailed":
      return { ...contextOf(state), name: "failed", step: "fetchingRecordedReceipt", failure: failureAfter(state, event.reason) };
    case "storedSessionFound":
    case "noStoredSession":
    case "sessionResumed":
    case "submittedSessionResumed":
    case "storedSessionStale":
    case "sessionStarted":
    case "questionnaireClosed":
    case "questionnaireNotFound":
    case "retryRequested":
    case "newSessionRequested":
    case "submitRequested":
    case "submitAccepted":
    case "submissionRejected":
    case "answerChanged":
    case "alreadySubmitted":
      return state;
  }
}

export function transition(state: RespondentState, event: RespondentEvent): RespondentState {
  switch (state.name) {
    case "entering":
      return fromEntering(state, event);
    case "resuming":
      return fromResuming(state, event);
    case "starting":
      return fromStarting(state, state.carriedAnswers, event);
    case "startingNewSession":
      return fromStarting(state, state.stored.answers, event);
    case "ready":
      return fromReady(state, event);
    case "submitting":
      return fromSubmitting(state, event);
    case "fetchingRecordedReceipt":
      return fromFetchingRecordedReceipt(state, event);
    case "failed":
      return fromFailed(state, event);
    case "done":
    case "closed":
    case "notFound":
      return state;
  }
}
