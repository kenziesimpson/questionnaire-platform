import {
  answerFor,
  respondentDateContext,
  validateAnswer,
  visibleItems,
  type ClientAnswers,
  type ClientAnswerValue,
  type Item,
  type PublishedDefinition,
  type SubmissionItemCode,
} from "@qp/shared";
import { AlertCircleIcon, RotateCcwIcon } from "@qp/ui/icons";
import { cn } from "@qp/ui/lib/utils";
import { alertVariants, AlertDescription, AlertTitle } from "@qp/ui/primitives/alert";
import { Button } from "@qp/ui/primitives/button";
import { focusItem, QuestionnaireForm, type ItemErrors } from "@qp/ui/questionnaire";
import { useForm, useStore } from "@tanstack/react-form";
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type FocusEvent } from "react";
import { browserTimeZone } from "../answers/precheck";
import type { SubmissionRejection } from "../answers/submission-rejection";
import type { FormContext } from "../session/respondent-state";
import type { SubmitFailureView } from "../session/respondent-view";
import { ErrorSummary, errorSummaryEntries, errorSummaryTitle } from "./error-summary";
import { RetryButton, type RetryControl } from "./retry-button";
import { Lead, ScreenHeading, ScreenLayout } from "./screen-layout";
import { TRANSIENT_FAILURE_EXPLANATION } from "./terminal-screens";

export interface QuestionnaireScreenProps {
  readonly form: FormContext;
  readonly submitting: boolean;
  readonly submitFailure: SubmitFailureView | null;
  readonly rejection: SubmissionRejection | null;
  readonly onAnswerChange: (itemId: string) => void;
  readonly onPersist: (answers: ClientAnswers) => void;
  readonly onSubmit: (answers: ClientAnswers) => Promise<void>;
}

const NO_ERRORS: ItemErrors = {};
const ITEM_ID_ATTRIBUTE = "data-item-id";

type AnswerFieldName = `answers.${string}`;

function answerFieldName(itemId: string): AnswerFieldName {
  return `answers.${itemId}`;
}

function answerFieldValidator(item: Item, timeZone: string) {
  return ({ value }: { value: ClientAnswerValue | null | undefined }): SubmissionItemCode[] | undefined => {
    if (value === null || value === undefined) return undefined;
    const codes = validateAnswer(item.question, value, respondentDateContext(new Date(), timeZone));
    return codes.length > 0 ? codes : undefined;
  };
}

function requiredAnswersValidator(definition: PublishedDefinition) {
  return ({ value }: { value: { answers: ClientAnswers } }) => {
    const fields: Partial<Record<string, SubmissionItemCode[]>> = {};
    for (const item of visibleItems(definition, value.answers)) {
      if (item.required && answerFor(value.answers, item.itemId) === undefined) {
        fields[answerFieldName(item.itemId)] = ["answer/required"];
      }
    }
    return Object.keys(fields).length > 0 ? { fields } : undefined;
  };
}

function itemIdFromBlurTarget(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  return target.closest(`[${ITEM_ID_ATTRIBUTE}]`)?.getAttribute(ITEM_ID_ATTRIBUTE) ?? undefined;
}

function RestoreStrip() {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted px-4 py-3 text-sm">
      <RotateCcwIcon aria-hidden="true" className="shrink-0 text-muted-foreground" size={16} />
      <p>We restored the answers you started on this device.</p>
    </div>
  );
}

function SubmitFailedAlert({ retry }: { retry: RetryControl | null }) {
  const messageId = useId();
  return (
    <div className={cn(alertVariants({ variant: "destructive" }), "flex-col items-stretch gap-4 py-4")}>
      <div id={messageId} role="alert" className="flex gap-2">
        <AlertCircleIcon aria-hidden="true" className="mt-0.5 shrink-0 text-destructive" size={16} />
        <div className="flex flex-col gap-1 leading-relaxed">
          <AlertTitle className="text-destructive">Your answers were not submitted.</AlertTitle>
          <AlertDescription className="text-sm leading-relaxed text-foreground">
            They are still saved on this device.
            {retry !== null && ` ${TRANSIENT_FAILURE_EXPLANATION}`}
          </AlertDescription>
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

export function QuestionnaireScreen({
  form: context,
  submitting,
  submitFailure,
  rejection,
  onAnswerChange,
  onPersist,
  onSubmit,
}: QuestionnaireScreenProps) {
  const { definition, restoredAnswers, restored } = context;
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const announcerRef = useRef<HTMLParagraphElement>(null);
  const focusRequests = useFocusRequests(submitting, rejection);
  const timeZone = useMemo(() => browserTimeZone(), []);

  const form = useForm({
    defaultValues: { answers: restoredAnswers },
    validators: { onChange: requiredAnswersValidator(definition) },
    listeners: {
      onChange: ({ formApi }) => onPersist(formApi.state.values.answers),
    },
    onSubmit: ({ value }) => onSubmit(value.answers),
    onSubmitInvalid: focusRequests.request,
  });

  const answers = useStore(form.store, (state) => state.values.answers);
  const fieldMetaBase = useStore(form.store, (state) => state.fieldMetaBase);
  const shown = useMemo(() => visibleItems(definition, answers), [definition, answers]);

  const clientErrors = useMemo(() => {
    const result: Record<string, SubmissionItemCode[]> = {};
    for (const item of shown) {
      const meta = fieldMetaBase[answerFieldName(item.itemId)];
      if (meta?.isTouched !== true) continue;
      const codes = meta.errorMap.onChange as SubmissionItemCode[] | undefined;
      if (codes !== undefined && codes.length > 0) result[item.itemId] = codes;
    }
    return result;
  }, [shown, fieldMetaBase]);

  const serverErrors = rejection?.itemErrors ?? NO_ERRORS;
  const errors = useMemo(() => ({ ...serverErrors, ...clientErrors }), [serverErrors, clientErrors]);
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
    const name = answerFieldName(itemId);
    form.setFieldValue(name, answer, { dontUpdateMeta: true, dontValidate: true });
    if (form.getFieldMeta(name)?.isTouched === true) form.validateField(name, "change");
    onAnswerChange(itemId);
  }

  function handleFormBlur(event: FocusEvent<HTMLFormElement>) {
    const itemId = itemIdFromBlurTarget(event.target);
    if (itemId === undefined) return;
    const stayedWithinItem = itemIdFromBlurTarget(event.relatedTarget) === itemId;
    if (stayedWithinItem) return;
    form.validateField(answerFieldName(itemId), "change");
  }

  async function submitForm() {
    await form.validateAllFields("submit");
    await form.validate("submit");
    await form.handleSubmit();
  }

  function jumpTo(itemId: string) {
    if (formRef.current !== null) focusItem(formRef.current, itemId);
  }

  const retry: RetryControl | null =
    submitFailure !== null && submitFailure.retryable
      ? { attempt: submitFailure.attempt, retrying: submitting, onRetry: () => void submitForm() }
      : null;

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
        onBlur={handleFormBlur}
        onSubmit={(event) => {
          event.preventDefault();
          void submitForm();
        }}
      >
        {shown.map((item) => (
          <form.Field key={item.itemId} name={answerFieldName(item.itemId)} validators={{ onChange: answerFieldValidator(item, timeZone) }}>
            {() => null}
          </form.Field>
        ))}
        {showSummary && <ErrorSummary ref={summaryRef} entries={entries} unplacedErrors={unplacedErrors} onJump={jumpTo} />}
        <QuestionnaireForm definition={definition} answers={answers} errors={errors} mode="interactive" onChange={changeAnswer} />
        {submitFailure !== null && <SubmitFailedAlert key={submitFailure.attempt} retry={retry} />}
        <div className="flex flex-col sm:flex-row">
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(formSubmitting) => (
              <Button type="submit" size="lg" disabled={submitting || formSubmitting}>
                {submitting ? "Submitting…" : "Submit answers"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
      <p ref={announcerRef} role="status" className="sr-only" />
      <p className="border-t pt-4 text-xs text-muted-foreground">
        {definition.title} · version {definition.version}
      </p>
    </ScreenLayout>
  );
}
