import { INTAKE_QUESTIONNAIRE_ID, type ClientAnswers } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { INITIAL_STATE, transition, type FormContext, type RespondentEvent, type RespondentState } from "../../src/session/respondent-state.ts";
import type { SubmissionRejection } from "../../src/answers/submission-rejection.ts";
import type { StoredPartials } from "../../src/storage/partials.ts";
import { inProgressSession, intakeV1, receipt, SESSION_ID } from "../fixtures.ts";

function stored(answers: ClientAnswers): StoredPartials {
  return { formatVersion: 1, sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers, updatedAt: "2026-09-14T09:05:00.000Z" };
}

const restoredAnswers: ClientAnswers = { itm_04: { type: "text", text: "Corner pharmacy" } };
const form: FormContext = { session: inProgressSession, definition: intakeV1, restoredAnswers, restored: true };
const networkError = { kind: "network-error" } as const;
const rejection: SubmissionRejection = { itemErrors: { itm_04: ["text/too-long"] }, unplacedErrors: true };

const events: Record<RespondentEvent["type"], RespondentEvent> = {
  storedSessionFound: { type: "storedSessionFound", stored: stored(restoredAnswers) },
  noStoredSession: { type: "noStoredSession" },
  sessionResumed: { type: "sessionResumed", session: inProgressSession, definition: intakeV1 },
  submittedSessionResumed: { type: "submittedSessionResumed", receipt, definition: intakeV1 },
  storedSessionStale: { type: "storedSessionStale" },
  sessionStarted: { type: "sessionStarted", session: inProgressSession, definition: intakeV1 },
  questionnaireClosed: { type: "questionnaireClosed" },
  questionnaireNotFound: { type: "questionnaireNotFound" },
  requestFailed: { type: "requestFailed", reason: networkError },
  submitRequested: { type: "submitRequested" },
  submitAccepted: { type: "submitAccepted", receipt },
  submissionRejected: { type: "submissionRejected", rejection },
  answerChanged: { type: "answerChanged", itemId: "itm_04" },
  alreadySubmitted: { type: "alreadySubmitted" },
  recordedReceiptFetched: { type: "recordedReceiptFetched", receipt, definition: intakeV1 },
};

const states: Record<string, RespondentState> = {
  entering: INITIAL_STATE,
  resuming: { name: "resuming", stored: stored(restoredAnswers) },
  starting: { name: "starting" },
  ready: { name: "ready", ...form, rejection: null },
  "ready after a rejection": { name: "ready", ...form, rejection },
  submitting: { name: "submitting", ...form },
  fetchingRecordedReceipt: { name: "fetchingRecordedReceipt", ...form },
  done: { name: "done", receipt, definition: intakeV1, alreadySubmitted: false },
  "done, already submitted": { name: "done", receipt, definition: intakeV1, alreadySubmitted: true },
  closed: { name: "closed" },
  notFound: { name: "notFound" },
  "failed during entry": { name: "failed", reason: networkError, form: null },
  "failed during submit": { name: "failed", reason: networkError, form },
};

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
    requestFailed: states["failed during entry"],
  },
  starting: {
    sessionStarted: { name: "ready", session: inProgressSession, definition: intakeV1, restoredAnswers: {}, restored: false, rejection: null },
    questionnaireClosed: states.closed,
    questionnaireNotFound: states.notFound,
    requestFailed: states["failed during entry"],
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
    requestFailed: states["failed during submit"],
  },
  fetchingRecordedReceipt: {
    recordedReceiptFetched: states["done, already submitted"],
    requestFailed: states["failed during entry"],
  },
  done: {},
  "done, already submitted": {},
  closed: {},
  notFound: {},
  "failed during entry": {},
  "failed during submit": { submitRequested: states.submitting },
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
    const resuming: RespondentState = { name: "resuming", stored: stored({ itm_04: null }) };

    expect(transition(resuming, events.sessionResumed)).toMatchObject({ name: "ready", restored: false });
  });

  it("keeps a rejection untouched when an answer without a server error changes", () => {
    const rejected: RespondentState = { name: "ready", ...form, rejection };

    expect(transition(rejected, { type: "answerChanged", itemId: "itm_01" })).toBe(rejected);
  });
});
