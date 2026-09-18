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

const fetchExecutionClient: ExecutionClient = { createSession, getSession, submitSession };

export interface PartialsStorage {
  readonly readPartials: typeof readPartials;
  readonly writePartials: typeof writePartials;
  readonly removePartials: typeof removePartials;
  readonly clearPartialAnswers: typeof clearPartialAnswers;
}

const localPartialsStorage: PartialsStorage = { readPartials, writePartials, removePartials, clearPartialAnswers };

export interface RespondentSession {
  readonly getState: () => RespondentState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly enter: () => Promise<void>;
  readonly changeAnswers: (itemId: string) => void;
  readonly submit: (answers: ClientAnswers) => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly startNewSession: () => Promise<void>;
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

function unreachable(value: never): never {
  throw new Error(`Unhandled problem slug: ${JSON.stringify(value)}`);
}

export function createRespondentSession(
  questionnaireId: string,
  client: ExecutionClient = fetchExecutionClient,
  storage: PartialsStorage = localPartialsStorage,
): RespondentSession {
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

  async function start(carriedAnswers: ClientAnswers) {
    const outcome = await client.createSession(questionnaireId);
    if (outcome.kind === "ok") {
      const { session, definition } = outcome.body;
      storage.writePartials(session, carriedAnswers);
      dispatch({ type: "sessionStarted", session, definition });
      return;
    }
    if (outcome.kind !== "problem") {
      failed(outcome);
      return;
    }
    switch (outcome.slug) {
      case "questionnaire/closed":
        dispatch({ type: "questionnaireClosed" });
        return;
      case "resource/not-found":
        dispatch({ type: "questionnaireNotFound" });
        return;
      case "request/invalid":
      case "internal":
        failed(outcome);
        return;
      default:
        return unreachable(outcome);
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
        storage.clearPartialAnswers(session);
        dispatch({ type: "submittedSessionResumed", receipt, definition });
      }
      return;
    }
    if (outcome.kind !== "problem") {
      failed(outcome);
      return;
    }
    switch (outcome.slug) {
      case "resource/not-found":
        storage.removePartials(questionnaireId);
        dispatch({ type: "storedSessionStale" });
        await start({});
        return;
      case "questionnaire/closed":
        dispatch({ type: "questionnaireClosed" });
        return;
      case "request/invalid":
      case "internal":
        failed(outcome);
        return;
      default:
        return unreachable(outcome);
    }
  }

  async function enter() {
    if (state.name !== "entering") return;
    const stored = storage.readPartials(questionnaireId);
    if (stored === undefined) {
      dispatch({ type: "noStoredSession" });
      await start({});
    } else {
      dispatch({ type: "storedSessionFound", stored });
      await resume(stored);
    }
  }

  function changeAnswers(itemId: string) {
    if (formContextOf(state) === null) return;
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
      storage.clearPartialAnswers(session);
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
      storage.clearPartialAnswers(session);
      dispatch({ type: "submitAccepted", receipt: outcome.body.receipt });
      return;
    }
    if (outcome.kind !== "problem") {
      failed(outcome);
      return;
    }
    switch (outcome.slug) {
      case "submission/invalid":
        dispatch({ type: "submissionRejected", rejection: submissionRejectionOf(definition, answers, outcome.problem) });
        return;
      case "session/already-submitted":
        dispatch({ type: "alreadySubmitted" });
        await fetchRecordedReceipt(session);
        return;
      case "questionnaire/closed":
        dispatch({ type: "questionnaireClosed" });
        return;
      case "request/invalid":
      case "resource/not-found":
      case "internal":
        failed(outcome);
        return;
      default:
        return unreachable(outcome);
    }
  }

  async function retry() {
    const failed = state;
    if (failed.name !== "failed") return;
    dispatch({ type: "retryRequested" });
    if (state === failed) return;
    switch (failed.step) {
      case "starting":
        return start(failed.carriedAnswers);
      case "resuming":
        return resume(failed.stored);
      case "fetchingRecordedReceipt":
        return fetchRecordedReceipt(failed.session);
      case "submitting":
        return;
    }
  }

  async function startNewSession() {
    const failed = state;
    if (failed.name !== "failed" || failed.step !== "resuming") return;
    dispatch({ type: "newSessionRequested" });
    if (state === failed) return;
    await start(failed.stored.answers);
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
    retry,
    startNewSession,
  };
}
