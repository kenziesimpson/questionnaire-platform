import { type ClientAnswers } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { describe, expect, it } from "vitest";
import { viewOf, type RespondentView } from "../../src/session/respondent-view";
import type { Failure, FailureReason, FormContext, RespondentState } from "../../src/session/respondent-state";
import type { SubmissionRejection } from "../../src/answers/submission-rejection";
import type { StoredPartials } from "../../src/storage/partials";
import { inProgressSession, intakeV1, receipt, SESSION_ID } from "../fixtures";

function stored(answers: ClientAnswers): StoredPartials {
  return { formatVersion: 1, sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers, updatedAt: "2026-09-14T09:05:00.000Z" };
}

const restoredAnswers: ClientAnswers = { itm_04: { type: "text", text: "Corner pharmacy" } };
const form: FormContext = { session: inProgressSession, definition: intakeV1, restoredAnswers, restored: true };
const withAnswers = stored(restoredAnswers);
const withoutAnswers = stored({ itm_04: null });

const networkFailure: Failure = { reason: { kind: "network-error" }, attempt: 1 };
const secondNetworkFailure: Failure = { reason: { kind: "network-error" }, attempt: 2 };
const notRetryableFailure: Failure = { reason: { kind: "problem", slug: "request/invalid" }, attempt: 1 };
const rejection: SubmissionRejection = { itemErrors: { itm_04: ["text/too-long"] }, unplacedErrors: true };

const cases: Array<[string, RespondentState, RespondentView]> = [
  ["entering", { name: "entering" }, { kind: "loading" }],
  ["starting, first attempt", { name: "starting", carriedAnswers: {}, previousFailure: null }, { kind: "loading" }],
  [
    "starting, retrying after a transient failure",
    { name: "starting", carriedAnswers: {}, previousFailure: networkFailure },
    { kind: "loadFailed", attempt: 1, retrying: true },
  ],
  [
    "starting, retrying after a non-retryable failure",
    { name: "starting", carriedAnswers: {}, previousFailure: notRetryableFailure },
    { kind: "entryFailed" },
  ],
  ["resuming, first attempt", { name: "resuming", stored: withAnswers, previousFailure: null }, { kind: "loading" }],
  [
    "resuming, retrying after a transient failure with answers stored",
    { name: "resuming", stored: withAnswers, previousFailure: networkFailure },
    { kind: "savedAnswersResumeFailed", attempt: 1, retrying: true, startingNewSession: false },
  ],
  [
    "resuming, retrying after a transient failure with no answers stored",
    { name: "resuming", stored: withoutAnswers, previousFailure: networkFailure },
    { kind: "loadFailed", attempt: 1, retrying: true },
  ],
  [
    "resuming, retrying after a non-retryable failure",
    { name: "resuming", stored: withAnswers, previousFailure: notRetryableFailure },
    { kind: "entryFailed" },
  ],
  [
    "startingNewSession",
    { name: "startingNewSession", stored: withAnswers, previousFailure: networkFailure },
    { kind: "savedAnswersResumeFailed", attempt: 1, retrying: false, startingNewSession: true },
  ],
  [
    "startingNewSession, with no answers stored",
    { name: "startingNewSession", stored: withoutAnswers, previousFailure: networkFailure },
    { kind: "loadFailed", attempt: 1, retrying: false },
  ],
  [
    "ready, with no rejection",
    { name: "ready", ...form, rejection: null },
    { kind: "questionnaire", form, submitting: false, submitFailure: null, rejection: null },
  ],
  [
    "ready, with a rejection",
    { name: "ready", ...form, rejection },
    { kind: "questionnaire", form, submitting: false, submitFailure: null, rejection },
  ],
  [
    "submitting, first attempt",
    { name: "submitting", ...form, previousFailure: null },
    { kind: "questionnaire", form, submitting: true, submitFailure: null, rejection: null },
  ],
  [
    "submitting, retrying after a transient failure",
    { name: "submitting", ...form, previousFailure: networkFailure },
    { kind: "questionnaire", form, submitting: true, submitFailure: { attempt: 1, retryable: true }, rejection: null },
  ],
  [
    "fetchingRecordedReceipt, first attempt",
    { name: "fetchingRecordedReceipt", ...form, previousFailure: null },
    { kind: "questionnaire", form, submitting: true, submitFailure: null, rejection: null },
  ],
  [
    "fetchingRecordedReceipt, retrying after a transient failure",
    { name: "fetchingRecordedReceipt", ...form, previousFailure: networkFailure },
    { kind: "recordedReceiptFailed", attempt: 1, retrying: true },
  ],
  [
    "fetchingRecordedReceipt, retrying after a non-retryable failure",
    { name: "fetchingRecordedReceipt", ...form, previousFailure: notRetryableFailure },
    { kind: "entryFailed" },
  ],
  [
    "done",
    { name: "done", receipt, definition: intakeV1, alreadySubmitted: false },
    { kind: "receipt", receipt, definition: intakeV1, alreadySubmitted: false },
  ],
  ["closed", { name: "closed" }, { kind: "closed" }],
  ["notFound", { name: "notFound" }, { kind: "notFound" }],
  [
    "failed starting, retryable",
    { name: "failed", step: "starting", carriedAnswers: {}, failure: secondNetworkFailure },
    { kind: "loadFailed", attempt: 2, retrying: false },
  ],
  [
    "failed starting, not retryable",
    { name: "failed", step: "starting", carriedAnswers: {}, failure: notRetryableFailure },
    { kind: "entryFailed" },
  ],
  [
    "failed resuming, retryable, with answers stored",
    { name: "failed", step: "resuming", stored: withAnswers, failure: networkFailure },
    { kind: "savedAnswersResumeFailed", attempt: 1, retrying: false, startingNewSession: false },
  ],
  [
    "failed resuming, retryable, with no answers stored",
    { name: "failed", step: "resuming", stored: withoutAnswers, failure: networkFailure },
    { kind: "loadFailed", attempt: 1, retrying: false },
  ],
  [
    "failed resuming, not retryable",
    { name: "failed", step: "resuming", stored: withAnswers, failure: notRetryableFailure },
    { kind: "entryFailed" },
  ],
  [
    "failed submitting, retryable",
    { name: "failed", step: "submitting", ...form, failure: networkFailure },
    { kind: "questionnaire", form, submitting: false, submitFailure: { attempt: 1, retryable: true }, rejection: null },
  ],
  [
    "failed submitting, not retryable",
    { name: "failed", step: "submitting", ...form, failure: notRetryableFailure },
    { kind: "questionnaire", form, submitting: false, submitFailure: { attempt: 1, retryable: false }, rejection: null },
  ],
  [
    "failed fetchingRecordedReceipt, retryable",
    { name: "failed", step: "fetchingRecordedReceipt", ...form, failure: networkFailure },
    { kind: "recordedReceiptFailed", attempt: 1, retrying: false },
  ],
  [
    "failed fetchingRecordedReceipt, not retryable",
    { name: "failed", step: "fetchingRecordedReceipt", ...form, failure: notRetryableFailure },
    { kind: "entryFailed" },
  ],
];

describe("viewOf", () => {
  it.each(cases)("%s", (_case, state, expected) => {
    expect(viewOf(state)).toEqual(expected);
  });

  it.each<[string, FailureReason, boolean]>([
    ["a network error", { kind: "network-error" }, true],
    ["submission/invalid", { kind: "problem", slug: "submission/invalid" }, false],
  ])("carries isRetryable's verdict for %s into a submit failure's retryable flag: %s", (_case, reason, retryable) => {
    const failed: RespondentState = { name: "failed", step: "submitting", ...form, failure: { reason, attempt: 3 } };

    expect(viewOf(failed)).toEqual({
      kind: "questionnaire",
      form,
      submitting: false,
      submitFailure: { attempt: 3, retryable },
      rejection: null,
    });
  });
});
