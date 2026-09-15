import type { ClientAnswers, PublishedDefinition, Receipt, Session } from "@qp/shared";
import { withoutItemError, type SubmissionRejection } from "../answers/submission-rejection.ts";
import type { ExecutionProblemSlug } from "../api/problems.ts";
import type { StoredPartials } from "../storage/partials.ts";

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

export type RespondentState =
  | { readonly name: "entering" }
  | { readonly name: "resuming"; readonly stored: StoredPartials }
  | { readonly name: "starting" }
  | ({ readonly name: "ready"; readonly rejection: SubmissionRejection | null } & FormContext)
  | ({ readonly name: "submitting" } & FormContext)
  | ({ readonly name: "fetchingRecordedReceipt" } & FormContext)
  | { readonly name: "done"; readonly receipt: Receipt; readonly definition: PublishedDefinition; readonly alreadySubmitted: boolean }
  | { readonly name: "closed" }
  | { readonly name: "notFound" }
  | { readonly name: "failed"; readonly reason: FailureReason; readonly form: FormContext | null };

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
  | { readonly type: "submitRequested" }
  | { readonly type: "submitAccepted"; readonly receipt: Receipt }
  | { readonly type: "submissionRejected"; readonly rejection: SubmissionRejection }
  | { readonly type: "answerChanged"; readonly itemId: string }
  | { readonly type: "alreadySubmitted" }
  | { readonly type: "recordedReceiptFetched"; readonly receipt: Receipt; readonly definition: PublishedDefinition };

export const INITIAL_STATE: RespondentState = { name: "entering" };

function hasAnswer(answers: ClientAnswers): boolean {
  return Object.values(answers).some((answer) => answer !== null);
}

function contextOf({ session, definition, restoredAnswers, restored }: FormContext): FormContext {
  return { session, definition, restoredAnswers, restored };
}

export function formContextOf(state: RespondentState): FormContext | null {
  switch (state.name) {
    case "ready":
    case "submitting":
    case "fetchingRecordedReceipt":
      return state;
    case "failed":
      return state.form;
    default:
      return null;
  }
}

function fromEntering(state: RespondentState, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "storedSessionFound":
      return { name: "resuming", stored: event.stored };
    case "noStoredSession":
      return { name: "starting" };
    default:
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
        restored: hasAnswer(answers),
        rejection: null,
      };
    }
    case "submittedSessionResumed":
      return { name: "done", receipt: event.receipt, definition: event.definition, alreadySubmitted: false };
    case "storedSessionStale":
      return { name: "starting" };
    case "questionnaireClosed":
      return { name: "closed" };
    case "requestFailed":
      return { name: "failed", reason: event.reason, form: null };
    default:
      return state;
  }
}

function fromStarting(state: RespondentState, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "sessionStarted":
      return { name: "ready", session: event.session, definition: event.definition, restoredAnswers: {}, restored: false, rejection: null };
    case "questionnaireClosed":
      return { name: "closed" };
    case "questionnaireNotFound":
      return { name: "notFound" };
    case "requestFailed":
      return { name: "failed", reason: event.reason, form: null };
    default:
      return state;
  }
}

function fromReady(state: Extract<RespondentState, { name: "ready" }>, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "submitRequested":
      return { ...contextOf(state), name: "submitting" };
    case "answerChanged": {
      const rejection = state.rejection === null ? null : withoutItemError(state.rejection, event.itemId);
      return rejection === state.rejection ? state : { ...state, rejection };
    }
    default:
      return state;
  }
}

function fromFailed(state: Extract<RespondentState, { name: "failed" }>, event: RespondentEvent): RespondentState {
  return state.form !== null && event.type === "submitRequested" ? { ...state.form, name: "submitting" } : state;
}

function fromSubmitting(state: Extract<RespondentState, { name: "submitting" }>, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "submitAccepted":
      return { name: "done", receipt: event.receipt, definition: state.definition, alreadySubmitted: false };
    case "submissionRejected":
      return { ...contextOf(state), name: "ready", rejection: event.rejection };
    case "alreadySubmitted":
      return { ...contextOf(state), name: "fetchingRecordedReceipt" };
    case "questionnaireClosed":
      return { name: "closed" };
    case "requestFailed":
      return { name: "failed", reason: event.reason, form: contextOf(state) };
    default:
      return state;
  }
}

function fromFetchingRecordedReceipt(state: RespondentState, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "recordedReceiptFetched":
      return { name: "done", receipt: event.receipt, definition: event.definition, alreadySubmitted: true };
    case "requestFailed":
      return { name: "failed", reason: event.reason, form: null };
    default:
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
      return fromStarting(state, event);
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
