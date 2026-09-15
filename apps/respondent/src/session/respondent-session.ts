import { sensitive, visibleAnswers, type ClientAnswers, type Receipt, type Session } from "@qp/shared";
import { submissionRejectionOf } from "../answers/submission-rejection.ts";
import { createSession, getSession, submitSession } from "../api/execution-client.ts";
import type { ExecutionOutcome } from "../api/request.ts";
import type { ExecutionProblemSlug } from "../api/problems.ts";
import { clearPartialAnswers, readPartials, removePartials, writePartials, type StoredPartials } from "../storage/partials.ts";
import { formContextOf, INITIAL_STATE, transition, type FailureReason, type RespondentEvent, type RespondentState } from "./respondent-state.ts";

export interface ExecutionClient {
  readonly createSession: typeof createSession;
  readonly getSession: typeof getSession;
  readonly submitSession: typeof submitSession;
}

export const fetchExecutionClient: ExecutionClient = { createSession, getSession, submitSession };

export interface RespondentSession {
  readonly getState: () => RespondentState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly enter: () => Promise<void>;
  readonly changeAnswers: (itemId: string, answers: ClientAnswers) => void;
  readonly submit: (answers: ClientAnswers) => Promise<void>;
}

type FailedOutcome = Exclude<ExecutionOutcome<unknown, ExecutionProblemSlug>, { kind: "ok" }>;

function failureReasonOf(outcome: FailedOutcome): FailureReason {
  switch (outcome.kind) {
    case "problem":
      return { kind: "problem", slug: outcome.slug };
    case "network-error":
      return { kind: "network-error" };
    case "unexpected-response":
      return { kind: "unexpected-response", status: outcome.status };
  }
}

function receiptOf({ sessionId, questionnaireId, version, submittedAt }: Session): Receipt | undefined {
  return submittedAt === null ? undefined : { sessionId, questionnaireId, version, submittedAt };
}

export function createRespondentSession(questionnaireId: string, client: ExecutionClient = fetchExecutionClient): RespondentSession {
  let state = INITIAL_STATE;
  const listeners = new Set<() => void>();

  function dispatch(event: RespondentEvent) {
    const next = transition(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function failed(outcome: FailedOutcome) {
    dispatch({ type: "requestFailed", reason: failureReasonOf(outcome) });
  }

  async function start() {
    const outcome = await client.createSession(questionnaireId);
    if (outcome.kind === "ok") {
      const { session, definition } = outcome.body;
      writePartials(session, {});
      dispatch({ type: "sessionStarted", session, definition });
    } else if (outcome.kind === "problem" && outcome.slug === "questionnaire/closed") {
      dispatch({ type: "questionnaireClosed" });
    } else if (outcome.kind === "problem" && outcome.slug === "resource/not-found") {
      dispatch({ type: "questionnaireNotFound" });
    } else {
      failed(outcome);
    }
  }

  async function resume(stored: StoredPartials) {
    const outcome = await client.getSession(stored.sessionId);
    if (outcome.kind === "ok") {
      const { session, definition } = outcome.body;
      const receipt = receiptOf(session);
      if (session.status === "in_progress") {
        dispatch({ type: "sessionResumed", session, definition });
      } else if (receipt === undefined) {
        failed({ kind: "unexpected-response", status: 200 });
      } else {
        clearPartialAnswers(session);
        dispatch({ type: "submittedSessionResumed", receipt, definition });
      }
    } else if (outcome.kind === "problem" && outcome.slug === "resource/not-found") {
      removePartials(questionnaireId);
      dispatch({ type: "storedSessionStale" });
      await start();
    } else if (outcome.kind === "problem" && outcome.slug === "questionnaire/closed") {
      dispatch({ type: "questionnaireClosed" });
    } else {
      failed(outcome);
    }
  }

  async function enter() {
    if (state.name !== "entering") return;
    const stored = readPartials(questionnaireId);
    if (stored === undefined) {
      dispatch({ type: "noStoredSession" });
      await start();
    } else {
      dispatch({ type: "storedSessionFound", stored });
      await resume(stored);
    }
  }

  function changeAnswers(itemId: string, answers: ClientAnswers) {
    const form = formContextOf(state);
    if (form === null) return;
    writePartials(form.session, answers);
    dispatch({ type: "answerChanged", itemId });
  }

  async function fetchRecordedReceipt(session: Session) {
    const outcome = await client.getSession(session.sessionId);
    if (outcome.kind !== "ok") {
      failed(outcome);
      return;
    }
    const receipt = receiptOf(outcome.body.session);
    if (receipt === undefined) {
      failed({ kind: "unexpected-response", status: 200 });
    } else {
      clearPartialAnswers(session);
      dispatch({ type: "recordedReceiptFetched", receipt, definition: outcome.body.definition });
    }
  }

  async function submit(answers: ClientAnswers) {
    const form = formContextOf(state);
    if (form === null || state.name === "submitting" || state.name === "fetchingRecordedReceipt") return;
    const { session, definition } = form;
    dispatch({ type: "submitRequested" });
    const outcome = await client.submitSession(session.sessionId, sensitive(visibleAnswers(definition, answers)));
    if (outcome.kind === "ok") {
      clearPartialAnswers(session);
      dispatch({ type: "submitAccepted", receipt: outcome.body.receipt });
    } else if (outcome.kind !== "problem") {
      failed(outcome);
    } else if (outcome.slug === "submission/invalid") {
      dispatch({ type: "submissionRejected", rejection: submissionRejectionOf(definition, answers, outcome.problem) });
    } else if (outcome.slug === "session/already-submitted") {
      dispatch({ type: "alreadySubmitted" });
      await fetchRecordedReceipt(session);
    } else if (outcome.slug === "questionnaire/closed") {
      dispatch({ type: "questionnaireClosed" });
    } else {
      failed(outcome);
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enter,
    changeAnswers,
    submit,
  };
}
