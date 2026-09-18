import type { ClientAnswers, ClientAnswerValue } from "@qp/shared";
import { focusItem, QuestionnaireForm, type ItemErrors } from "@qp/ui/questionnaire";
import { Button } from "@qp/ui/primitives/button";
import { revalidateLogic, useForm, useStore } from "@tanstack/react-form";
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { precheckAnswers } from "../answers/precheck.ts";
import type { SubmissionRejection } from "../answers/submission-rejection.ts";
import { isRetryable, type Failure, type FormContext } from "../session/respondent-state.ts";
import { ErrorSummary, errorSummaryEntries, errorSummaryTitle } from "./error-summary.tsx";
import { RetryButton, type RetryControl } from "./retry-button.tsx";
import { Lead, ScreenHeading, ScreenLayout } from "./screen-layout.tsx";
import { TRANSIENT_FAILURE_EXPLANATION } from "./terminal-screens.tsx";

export interface QuestionnaireScreenProps {
  readonly form: FormContext;
  readonly submitting: boolean;
  readonly submitFailure: Failure | null;
  readonly rejection: SubmissionRejection | null;
  readonly onAnswerChange: (itemId: string, answers: ClientAnswers) => void;
  readonly onSubmit: (answers: ClientAnswers) => Promise<void>;
}

const NO_ERRORS: ItemErrors = {};

function RestoreStrip() {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted px-4 py-3 text-sm">
      <svg
        aria-hidden="true"
        className="shrink-0 text-muted-foreground"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      <p>We restored the answers you started on this device.</p>
    </div>
  );
}

function SubmitFailedAlert({ retry }: { retry: RetryControl | null }) {
  const messageId = useId();
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
      <div id={messageId} role="alert" className="flex gap-2">
        <svg
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-destructive"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v5" />
          <path d="M12 16h.01" />
        </svg>
        <div className="flex flex-col gap-1 leading-relaxed">
          <p className="font-semibold text-destructive">Your answers were not submitted.</p>
          <p>
            They are still saved on this device.
            {retry !== null && ` ${TRANSIENT_FAILURE_EXPLANATION}`}
          </p>
        </div>
      </div>
      {retry !== null && (
        <div className="flex flex-col sm:flex-row sm:pl-6">
          <RetryButton retry={retry} describedBy={messageId} focusOnMount />
        </div>
      )}
    </div>
  );
}

function useFocusRequests(submitting: boolean, rejection: SubmissionRejection | null) {
  const [requests, setRequests] = useState(0);
  const [wasSubmitting, setWasSubmitting] = useState(submitting);
  if (wasSubmitting !== submitting) {
    setWasSubmitting(submitting);
    if (!submitting && rejection !== null) setRequests(requests + 1);
  }
  return { requests, request: () => setRequests((count) => count + 1) };
}

export function QuestionnaireScreen({ form: context, submitting, submitFailure, rejection, onAnswerChange, onSubmit }: QuestionnaireScreenProps) {
  const { definition, restoredAnswers, restored } = context;
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const announcerRef = useRef<HTMLParagraphElement>(null);
  const focusRequests = useFocusRequests(submitting, rejection);
  const form = useForm({
    defaultValues: { answers: restoredAnswers },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ({ value }) => precheckAnswers(definition, value.answers) },
    onSubmit: ({ value }) => onSubmit(value.answers),
    onSubmitInvalid: focusRequests.request,
  });
  const answers = useStore(form.store, (state) => state.values.answers);
  const precheckErrors = useStore(form.store, (state) => state.errorMap.onDynamic?.itemErrors ?? NO_ERRORS);
  const serverErrors = rejection?.itemErrors ?? NO_ERRORS;
  const errors = useMemo(() => ({ ...serverErrors, ...precheckErrors }), [serverErrors, precheckErrors]);
  const entries = useMemo(() => errorSummaryEntries(definition, answers, errors), [definition, answers, errors]);
  const unplacedErrors = rejection?.unplacedErrors ?? false;
  const showSummary = entries.length > 0 || unplacedErrors;

  const moveFocusToFirstError = useEffectEvent((request: number) => {
    const first = entries[0];
    const container = formRef.current;
    if (first === undefined || container === null || !focusItem(container, first.itemId)) {
      summaryRef.current?.focus();
      return;
    }
    if (announcerRef.current !== null) {
      announcerRef.current.textContent = `Your answers were not submitted. ${errorSummaryTitle(entries.length)}.${request % 2 === 0 ? "" : "\u00a0"}`;
    }
  });

  useEffect(() => {
    if (focusRequests.requests > 0) moveFocusToFirstError(focusRequests.requests);
  }, [focusRequests.requests]);

  function changeAnswer(itemId: string, answer: ClientAnswerValue | null) {
    form.setFieldValue("answers", (current) => ({ ...current, [itemId]: answer }));
    onAnswerChange(itemId, form.state.values.answers);
  }

  function submitRetry(failure: Failure): RetryControl | null {
    if (!isRetryable(failure.reason)) return null;
    return {
      attempt: failure.attempt,
      retrying: submitting,
      onRetry: () => void form.handleSubmit(),
    };
  }

  function jumpTo(itemId: string) {
    if (formRef.current !== null) focusItem(formRef.current, itemId);
  }

  return (
    <ScreenLayout>
      <ScreenHeading title={definition.title}>
        <Lead>Your answers are saved on this device as you go.</Lead>
      </ScreenHeading>
      {restored && <RestoreStrip />}
      <form
        ref={formRef}
        noValidate
        aria-label={definition.title}
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        {showSummary && <ErrorSummary ref={summaryRef} entries={entries} unplacedErrors={unplacedErrors} onJump={jumpTo} />}
        <QuestionnaireForm definition={definition} answers={answers} errors={errors} mode="interactive" onChange={changeAnswer} />
        {submitFailure !== null && <SubmitFailedAlert key={submitFailure.attempt} retry={submitRetry(submitFailure)} />}
        <div className="flex flex-col sm:flex-row">
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit answers"}
          </Button>
        </div>
      </form>
      <p ref={announcerRef} role="status" className="sr-only" />
      <p className="border-t pt-4 text-xs text-muted-foreground">
        {definition.title} · version {definition.version}
      </p>
    </ScreenLayout>
  );
}
