import type { ClientAnswers, ClientAnswerValue } from "@qp/shared";
import { QuestionnaireForm } from "@qp/ui/questionnaire";
import { Button } from "@qp/ui/primitives/button";
import { revalidateLogic, useForm, useStore } from "@tanstack/react-form";
import { precheckAnswers } from "../answers/precheck.ts";
import type { FormContext } from "../session/respondent-state.ts";
import { Lead, ScreenHeading, ScreenLayout } from "./screen-layout.tsx";

export interface QuestionnaireScreenProps {
  readonly form: FormContext;
  readonly submitting: boolean;
  readonly submitFailed: boolean;
  readonly onAnswersChange: (answers: ClientAnswers) => void;
  readonly onSubmit: (answers: ClientAnswers) => Promise<void>;
}

const NO_ERRORS = {};

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

function SubmitFailedAlert() {
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 px-4 py-3 text-sm text-destructive">
      Your answers were not submitted. They are still saved on this device.
    </div>
  );
}

export function QuestionnaireScreen({ form: context, submitting, submitFailed, onAnswersChange, onSubmit }: QuestionnaireScreenProps) {
  const { definition, restoredAnswers, restored } = context;
  const form = useForm({
    defaultValues: { answers: restoredAnswers },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ({ value }) => precheckAnswers(definition, value.answers) },
    onSubmit: ({ value }) => onSubmit(value.answers),
  });
  const answers = useStore(form.store, (state) => state.values.answers);
  const errors = useStore(form.store, (state) => state.errorMap.onDynamic?.itemErrors ?? NO_ERRORS);

  function changeAnswer(itemId: string, answer: ClientAnswerValue | null) {
    form.setFieldValue("answers", (current) => ({ ...current, [itemId]: answer }));
    onAnswersChange(form.state.values.answers);
  }

  return (
    <ScreenLayout>
      <ScreenHeading title={definition.title}>
        <Lead>Your answers are saved on this device as you go.</Lead>
      </ScreenHeading>
      {restored && <RestoreStrip />}
      <form
        noValidate
        aria-label={definition.title}
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <QuestionnaireForm definition={definition} answers={answers} errors={errors} mode="interactive" onChange={changeAnswer} />
        {submitFailed && <SubmitFailedAlert />}
        <div className="flex flex-col sm:flex-row">
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit answers"}
          </Button>
        </div>
      </form>
      <p className="border-t pt-4 text-xs text-muted-foreground">
        {definition.title} · version {definition.version}
      </p>
    </ScreenLayout>
  );
}
