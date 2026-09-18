import { type ClientAnswers } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { describe, expect, it } from "vitest";
import {
  INITIAL_STATE,
  isRetryable,
  transition,
  type Failure,
  type FailureReason,
  type FormContext,
  type RespondentEvent,
  type RespondentState,
} from "../../src/session/respondent-state.ts";
import type { SubmissionRejection } from "../../src/answers/submission-rejection.ts";
import type { StoredPartials } from "../../src/storage/partials.ts";
import { inProgressSession, intakeV1, receipt, SESSION_ID } from "../fixtures.ts";

function stored(answers: ClientAnswers): StoredPartials {
  return { formatVersion: 1, sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers, updatedAt: "2026-09-14T09:05:00.000Z" };
}

const restoredAnswers: ClientAnswers = { itm_04: { type: "text", text: "Corner pharmacy" } };
const form: FormContext = { session: inProgressSession, definition: intakeV1, restoredAnswers, restored: true };
const networkError = { kind: "network-error" } as const;
const firstFailure: Failure = { reason: networkError, attempt: 1 };
const secondFailure: Failure = { reason: networkError, attempt: 2 };
const notRetryable: Failure = { reason: { kind: "problem", slug: "request/invalid" }, attempt: 1 };
const rejection: SubmissionRejection = { itemErrors: { itm_04: ["text/too-long"] }, unplacedErrors: true };
const resumable = stored(restoredAnswers);

const events: Record<RespondentEvent["type"], RespondentEvent> = {
  storedSessionFound: { type: "storedSessionFound", stored: resumable },
  noStoredSession: { type: "noStoredSession" },
  sessionResumed: { type: "sessionResumed", session: inProgressSession, definition: intakeV1 },
  submittedSessionResumed: { type: "submittedSessionResumed", receipt, definition: intakeV1 },
  storedSessionStale: { type: "storedSessionStale" },
  sessionStarted: { type: "sessionStarted", session: inProgressSession, definition: intakeV1 },
  questionnaireClosed: { type: "questionnaireClosed" },
  questionnaireNotFound: { type: "questionnaireNotFound" },
  requestFailed: { type: "requestFailed", reason: networkError },
  retryRequested: { type: "retryRequested" },
  newSessionRequested: { type: "newSessionRequested" },
  submitRequested: { type: "submitRequested" },
  submitAccepted: { type: "submitAccepted", receipt },
  submissionRejected: { type: "submissionRejected", rejection },
  answerChanged: { type: "answerChanged", itemId: "itm_04" },
  alreadySubmitted: { type: "alreadySubmitted" },
  recordedReceiptFetched: { type: "recordedReceiptFetched", receipt, definition: intakeV1 },
};

const states: Record<string, RespondentState> = {
  entering: INITIAL_STATE,
  resuming: { name: "resuming", stored: resumable, previousFailure: null },
  "resuming again": { name: "resuming", stored: resumable, previousFailure: firstFailure },
  starting: { name: "starting", carriedAnswers: {}, previousFailure: null },
  "starting again": { name: "starting", carriedAnswers: {}, previousFailure: firstFailure },
  "starting again with carried answers": { name: "starting", carriedAnswers: restoredAnswers, previousFailure: firstFailure },
  startingNewSession: { name: "startingNewSession", stored: resumable, previousFailure: firstFailure },
  ready: { name: "ready", ...form, rejection: null },
  "ready after a rejection": { name: "ready", ...form, rejection },
  submitting: { name: "submitting", ...form, previousFailure: null },
  "submitting again": { name: "submitting", ...form, previousFailure: firstFailure },
  fetchingRecordedReceipt: { name: "fetchingRecordedReceipt", ...form, previousFailure: null },
  "fetchingRecordedReceipt again": { name: "fetchingRecordedReceipt", ...form, previousFailure: firstFailure },
  done: { name: "done", receipt, definition: intakeV1, alreadySubmitted: false },
  "done, already submitted": { name: "done", receipt, definition: intakeV1, alreadySubmitted: true },
  closed: { name: "closed" },
  notFound: { name: "notFound" },
  "failed starting": { name: "failed", step: "starting", carriedAnswers: {}, failure: firstFailure },
  "failed starting twice": { name: "failed", step: "starting", carriedAnswers: {}, failure: secondFailure },
  "failed starting a new session": { name: "failed", step: "starting", carriedAnswers: restoredAnswers, failure: secondFailure },
  "failed resuming": { name: "failed", step: "resuming", stored: resumable, failure: firstFailure },
  "failed resuming twice": { name: "failed", step: "resuming", stored: resumable, failure: secondFailure },
  "failed submitting": { name: "failed", step: "submitting", ...form, failure: firstFailure },
  "failed submitting twice": { name: "failed", step: "submitting", ...form, failure: secondFailure },
  "failed fetching the recorded receipt": { name: "failed", step: "fetchingRecordedReceipt", ...form, failure: firstFailure },
  "failed fetching the recorded receipt twice": { name: "failed", step: "fetchingRecordedReceipt", ...form, failure: secondFailure },
  "failed starting, not retryable": { name: "failed", step: "starting", carriedAnswers: {}, failure: notRetryable },
  "failed resuming, not retryable": { name: "failed", step: "resuming", stored: resumable, failure: notRetryable },
  "failed resuming with no answers stored": { name: "failed", step: "resuming", stored: stored({ itm_04: null }), failure: firstFailure },
  "failed submitting, not retryable": { name: "failed", step: "submitting", ...form, failure: notRetryable },
  "failed fetching the recorded receipt, not retryable": { name: "failed", step: "fetchingRecordedReceipt", ...form, failure: notRetryable },
};

const readyFromStart: RespondentState = { name: "ready", session: inProgressSession, definition: intakeV1, restoredAnswers: {}, restored: false, rejection: null };
const readyWithCarriedAnswers: RespondentState = { ...readyFromStart, restoredAnswers, restored: true };

const expected: Record<string, Partial<Record<RespondentEvent["type"], RespondentState>>> = {
  entering: {
    storedSessionFound: states.resuming,
    noStoredSession: states.starting,
  },
  resuming: {
    sessionResumed: states.ready,
    submittedSessionResumed: states.done,
    storedSessionStale: states.starting,
    questionnaireClosed: states.closed,
    requestFailed: states["failed resuming"],
  },
  "resuming again": {
    sessionResumed: states.ready,
    submittedSessionResumed: states.done,
    storedSessionStale: states["starting again"],
    questionnaireClosed: states.closed,
    requestFailed: states["failed resuming twice"],
  },
  starting: {
    sessionStarted: readyFromStart,
    questionnaireClosed: states.closed,
    questionnaireNotFound: states.notFound,
    requestFailed: states["failed starting"],
  },
  "starting again": {
    sessionStarted: readyFromStart,
    questionnaireClosed: states.closed,
    questionnaireNotFound: states.notFound,
    requestFailed: states["failed starting twice"],
  },
  "starting again with carried answers": {
    sessionStarted: readyWithCarriedAnswers,
    questionnaireClosed: states.closed,
    questionnaireNotFound: states.notFound,
    requestFailed: { name: "failed", step: "starting", carriedAnswers: restoredAnswers, failure: secondFailure },
  },
  startingNewSession: {
    sessionStarted: readyWithCarriedAnswers,
    questionnaireClosed: states.closed,
    questionnaireNotFound: states.notFound,
    requestFailed: states["failed starting a new session"],
  },
  ready: { submitRequested: states.submitting },
  "ready after a rejection": {
    submitRequested: states.submitting,
    answerChanged: { name: "ready", ...form, rejection: { itemErrors: {}, unplacedErrors: true } },
  },
  submitting: {
    submitAccepted: states.done,
    submissionRejected: states["ready after a rejection"],
    alreadySubmitted: states.fetchingRecordedReceipt,
    questionnaireClosed: states.closed,
    requestFailed: states["failed submitting"],
  },
  "submitting again": {
    submitAccepted: states.done,
    submissionRejected: states["ready after a rejection"],
    alreadySubmitted: states.fetchingRecordedReceipt,
    questionnaireClosed: states.closed,
    requestFailed: states["failed submitting twice"],
  },
  fetchingRecordedReceipt: {
    recordedReceiptFetched: states["done, already submitted"],
    requestFailed: states["failed fetching the recorded receipt"],
  },
  "fetchingRecordedReceipt again": {
    recordedReceiptFetched: states["done, already submitted"],
    requestFailed: states["failed fetching the recorded receipt twice"],
  },
  done: {},
  "done, already submitted": {},
  closed: {},
  notFound: {},
  "failed starting": { retryRequested: states["starting again"] },
  "failed starting twice": { retryRequested: { name: "starting", carriedAnswers: {}, previousFailure: secondFailure } },
  "failed starting a new session": {
    retryRequested: { name: "starting", carriedAnswers: restoredAnswers, previousFailure: secondFailure },
  },
  "failed resuming": { retryRequested: states["resuming again"], newSessionRequested: states.startingNewSession },
  "failed resuming twice": {
    retryRequested: { name: "resuming", stored: resumable, previousFailure: secondFailure },
    newSessionRequested: { name: "startingNewSession", stored: resumable, previousFailure: secondFailure },
  },
  "failed submitting": { submitRequested: states["submitting again"] },
  "failed submitting twice": { submitRequested: { name: "submitting", ...form, previousFailure: secondFailure } },
  "failed fetching the recorded receipt": { retryRequested: states["fetchingRecordedReceipt again"] },
  "failed fetching the recorded receipt twice": {
    retryRequested: { name: "fetchingRecordedReceipt", ...form, previousFailure: secondFailure },
  },
  "failed starting, not retryable": {},
  "failed resuming, not retryable": {},
  "failed resuming with no answers stored": {
    retryRequested: { name: "resuming", stored: stored({ itm_04: null }), previousFailure: firstFailure },
  },
  "failed submitting, not retryable": { submitRequested: { name: "submitting", ...form, previousFailure: notRetryable } },
  "failed fetching the recorded receipt, not retryable": {},
};

describe("transition", () => {
  const cases = Object.entries(states).flatMap(([stateName, state]) =>
    Object.entries(events).map(([eventType, event]) => ({ stateName, state, eventType, event })),
  );

  it.each(cases)("$stateName on $eventType", ({ stateName, state, eventType, event }) => {
    const next = transition(state, event);
    const target = expected[stateName]?.[event.type];

    if (target === undefined) expect(next, `${stateName} ignores ${eventType}`).toBe(state);
    else expect(next).toEqual(target);
  });

  it("restores without the strip when the stored envelope holds only nulls", () => {
    const resuming: RespondentState = { name: "resuming", stored: stored({ itm_04: null }), previousFailure: null };

    expect(transition(resuming, events.sessionResumed)).toMatchObject({ name: "ready", restored: false });
  });

  it("keeps a rejection untouched when an answer without a server error changes", () => {
    const rejected: RespondentState = { name: "ready", ...form, rejection };

    expect(transition(rejected, { type: "answerChanged", itemId: "itm_01" })).toBe(rejected);
  });

  it("records the reason of the latest failure while counting the attempts", () => {
    const unexpected: FailureReason = { kind: "unexpected-response", status: 503 };

    expect(transition(states["submitting again"] ?? INITIAL_STATE, { type: "requestFailed", reason: unexpected })).toEqual({
      name: "failed",
      step: "submitting",
      ...form,
      failure: { reason: unexpected, attempt: 2 },
    });
  });

  it("forgets earlier failures once a submission returns to the form with a rejection", () => {
    const rejected = transition(states["submitting again"] ?? INITIAL_STATE, events.submissionRejected);

    expect(transition(rejected, events.submitRequested)).toEqual(states.submitting);
  });
});

describe("isRetryable", () => {
  it.each<[string, FailureReason, boolean]>([
    ["a network error", { kind: "network-error" }, true],
    ["an unexpected 503", { kind: "unexpected-response", status: 503 }, true],
    ["an unparseable 200", { kind: "unexpected-response", status: 200 }, true],
    ["an internal problem", { kind: "problem", slug: "internal" }, true],
    ["request/invalid", { kind: "problem", slug: "request/invalid" }, false],
    ["resource/not-found", { kind: "problem", slug: "resource/not-found" }, false],
    ["questionnaire/closed", { kind: "problem", slug: "questionnaire/closed" }, false],
    ["session/already-submitted", { kind: "problem", slug: "session/already-submitted" }, false],
    ["submission/invalid", { kind: "problem", slug: "submission/invalid" }, false],
  ])("%s → %s", (_case, reason, retryable) => {
    expect(isRetryable(reason)).toBe(retryable);
  });
});
