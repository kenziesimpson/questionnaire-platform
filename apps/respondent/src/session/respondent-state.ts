import type { ClientAnswers, PublishedDefinition, Receipt, Session } from "@qp/shared";
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
  | ({ readonly name: "ready" } & FormContext)
  | ({ readonly name: "submitting" } & FormContext)
  | { readonly name: "done"; readonly receipt: Receipt; readonly definition: PublishedDefinition }
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
  | { readonly type: "submitAccepted"; readonly receipt: Receipt };

export const INITIAL_STATE: RespondentState = { name: "entering" };

function hasAnswer(answers: ClientAnswers): boolean {
  return Object.values(answers).some((answer) => answer !== null);
}

export function formContextOf(state: RespondentState): FormContext | null {
  switch (state.name) {
    case "ready":
    case "submitting":
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
      return { name: "ready", session: event.session, definition: event.definition, restoredAnswers: answers, restored: hasAnswer(answers) };
    }
    case "submittedSessionResumed":
      return { name: "done", receipt: event.receipt, definition: event.definition };
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
      return { name: "ready", session: event.session, definition: event.definition, restoredAnswers: {}, restored: false };
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

function fromSubmittable(state: RespondentState, form: FormContext, event: RespondentEvent): RespondentState {
  return event.type === "submitRequested" ? { ...form, name: "submitting" } : state;
}

function fromSubmitting(state: Extract<RespondentState, { name: "submitting" }>, event: RespondentEvent): RespondentState {
  switch (event.type) {
    case "submitAccepted":
      return { name: "done", receipt: event.receipt, definition: state.definition };
    case "questionnaireClosed":
      return { name: "closed" };
    case "requestFailed": {
      const { session, definition, restoredAnswers, restored } = state;
      return { name: "failed", reason: event.reason, form: { session, definition, restoredAnswers, restored } };
    }
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
      return fromSubmittable(state, state, event);
    case "submitting":
      return fromSubmitting(state, event);
    case "failed":
      return state.form === null ? state : fromSubmittable(state, state.form, event);
    case "done":
    case "closed":
    case "notFound":
      return state;
  }
}
