import { RESPONSE_TYPES, type QuestionVersion } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@qp/ui/primitives/dialog";
import { Input } from "@qp/ui/primitives/input";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { isProblem } from "../../api/problem-error";
import { ConstraintFields } from "./constraint-fields";
import { describedByFor, errorIdFor, FieldMessages } from "./field";
import { NO_ERRORS, hasErrors, missingEntries, placeErrors, type SaveErrors } from "./field-errors";
import { InfoIcon, LockIcon } from "./icons";
import {
  RESPONSE_TYPE_LABELS,
  blankForm,
  formFromQuestion,
  questionInputOf,
  yesNoForm,
  type QuestionForm,
} from "./question-form";
import { SegmentedControl } from "./segmented-control";
import { useSaveQuestion } from "./use-save-question";

export interface QuestionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question?: QuestionVersion;
  repinsInDraft?: string;
  onSaved: (saved: QuestionVersion) => void;
}

const TYPE_SEGMENTS = RESPONSE_TYPES.map((type) => ({ value: type, label: RESPONSE_TYPE_LABELS[type] }));

function failureMessage(error: Error): string {
  if (isProblem(error, "resource/not-found")) return "This question no longer exists, so no version was written.";
  if (isProblem(error, "question/version-conflict")) {
    return "Another save of this question landed at the same moment. Save again to write the next version.";
  }
  return "The question was not saved. Your changes are still here; check the connection and save again.";
}

function SaveNotice({ question, repinsInDraft }: Pick<QuestionEditorDialogProps, "question" | "repinsInDraft">) {
  const next = <strong className="font-semibold text-foreground">version {(question?.questionVersion ?? 0) + 1}</strong>;
  if (question === undefined) {
    return <>Saving writes {next} of a new question. Its response type is fixed from then on.</>;
  }
  const repin = repinsInDraft === undefined ? null : <> and re-pins this question in the {repinsInDraft} draft</>;
  const earlier =
    question.questionVersion === 1
      ? "Version 1 and everything published with it are untouched."
      : `Versions 1–${question.questionVersion} and everything published with them are untouched.`;
  return (
    <>
      Saving writes {next}
      {repin}. {earlier}
    </>
  );
}

function TypeRow({
  form,
  editing,
  errors,
  onChange,
}: {
  form: QuestionForm;
  editing: boolean;
  errors: SaveErrors;
  onChange: (form: QuestionForm) => void;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const errorId = errorIdFor(id);
  return (
    <div className="flex flex-col gap-1.5">
      <SegmentedControl
        legend="Response type"
        name="response-type"
        legendClassName="text-sm font-medium"
        value={form.type}
        segments={TYPE_SEGMENTS}
        disabled={editing}
        describedBy={describedByFor(errors.byField, "/type", errorId, noteId)}
        onChange={(type) => onChange({ ...form, type })}
        trailing={
          editing ? (
            <LockIcon className="text-muted-foreground" />
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => onChange(yesNoForm(form))}>
              Yes / No
            </Button>
          )
        }
      />
      <p id={noteId} className="text-xs leading-normal text-muted-foreground">
        {editing
          ? "Fixed after the first save. A rule that reads this question is typed to it, so a changed type would invalidate rules elsewhere."
          : "Fixed once saved. Yes / No creates a single choice with the reserved option ids yes and no; its labels stay editable."}
      </p>
      <FieldMessages id={errorId} messages={errors.byField["/type"]} />
    </div>
  );
}

function OpenQuestionEditor({ onOpenChange, question, repinsInDraft, onSaved }: Omit<QuestionEditorDialogProps, "open">) {
  const editing = question !== undefined;
  const [form, setForm] = useState(() => (question === undefined ? blankForm() : formFromQuestion(question)));
  const [errors, setErrors] = useState<SaveErrors>(NO_ERRORS);
  const [returnFocusTo] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const dragging = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const save = useSaveQuestion(question?.questionId);
  const promptId = useId();
  const promptErrorId = errorIdFor(promptId);
  const failure = save.error !== null && !isProblem(save.error, "request/invalid") ? failureMessage(save.error) : null;

  useEffect(() => {
    if (!hasErrors(errors)) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const change = (next: QuestionForm) => {
    setForm(next);
    setErrors(NO_ERRORS);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const missing = missingEntries(form);
    if (hasErrors(missing)) {
      setErrors(missing);
      return;
    }
    save.mutate(questionInputOf(form), {
      onSuccess: (saved) => {
        onSaved(saved);
        onOpenChange(false);
      },
      onError: (error) => {
        if (!isProblem(error, "request/invalid")) return;
        const placed = placeErrors(form, error.problem.errors);
        setErrors(hasErrors(placed) ? placed : { byField: {}, unplaced: ["The server refused this question."] });
      },
    });
  };

  const requestOpenChange = (next: boolean) => {
    if (!next && save.isPending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open onOpenChange={requestOpenChange}>
      <DialogContent
        className="top-16 flex max-h-[calc(100svh-5rem)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[620px]"
        onEscapeKeyDown={(event) => {
          if (dragging.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo?.focus();
        }}
      >
        <div className="flex flex-col gap-1 border-b border-border py-4 pr-12 pl-5">
          <DialogTitle className="text-base font-semibold tracking-tight">
            {editing ? "Edit question" : "New question"}
          </DialogTitle>
          {editing && <span className="font-mono text-xs text-muted-foreground">version {question.questionVersion}</span>}
        </div>
        <div className="flex items-start gap-2.5 border-b border-border bg-muted px-5 py-3">
          <InfoIcon />
          <DialogDescription className="text-xs leading-normal">
            <SaveNotice question={question} repinsInDraft={repinsInDraft} />
          </DialogDescription>
        </div>
        <form
          ref={formRef}
          noValidate
          aria-busy={save.isPending}
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
            {(failure !== null || errors.unplaced.length > 0) && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                {[...(failure === null ? [] : [failure]), ...errors.unplaced].map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            )}
            <TypeRow form={form} editing={editing} errors={errors} onChange={change} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={promptId} className="text-sm font-medium">
                Prompt
              </label>
              <Input
                id={promptId}
                value={form.prompt}
                aria-invalid={errors.byField["/prompt"] !== undefined || undefined}
                aria-describedby={describedByFor(errors.byField, "/prompt", promptErrorId)}
                onChange={(event) => change({ ...form, prompt: event.target.value })}
              />
              <FieldMessages id={promptErrorId} messages={errors.byField["/prompt"]} />
            </div>
            <ConstraintFields
              form={form}
              errors={errors.byField}
              onChange={change}
              onDraggingChange={(value) => {
                dragging.current = value;
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted px-5 py-3.5">
            <span className="text-xs text-muted-foreground">One save, one version.</span>
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={save.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : `Save as version ${(question?.questionVersion ?? 0) + 1}`}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function QuestionEditorDialog({ open, ...editor }: QuestionEditorDialogProps) {
  return open ? <OpenQuestionEditor {...editor} /> : null;
}
