import { RESPONSE_TYPES, type QuestionVersion } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Checkbox } from "@qp/ui/primitives/checkbox";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@qp/ui/primitives/dialog";
import { Input } from "@qp/ui/primitives/input";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { isProblem } from "../../api/problem-error";
import { ConstraintFields } from "./constraint-fields";
import { describedByFor, errorIdFor, FieldMessages } from "./field";
import { NO_ERRORS, hasErrors, missingEntries, placeErrors, type SaveErrors } from "./field-errors";
import { LockIcon } from "../../components/icons";
import {
  RESPONSE_TYPE_LABELS,
  blankForm,
  formFromQuestion,
  questionInputOf,
  edits,
  type QuestionForm,
} from "./question-form";
import { SegmentedControl } from "./segmented-control";
import { useSaveQuestion } from "./use-save-question";

export interface QuestionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question?: QuestionVersion;
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
        onChange={(type) => onChange(edits.type(form, type))}
        trailing={editing ? <LockIcon className="text-muted-foreground" /> : undefined}
      />
      <p id={noteId} className="text-xs leading-normal text-muted-foreground">
        {editing
          ? "Response type cannot be changed."
          : "Response type cannot be changed later. Options, naming, and constraints can be modified later."}
      </p>
      <FieldMessages id={errorId} messages={errors.byField["/type"]} />
    </div>
  );
}

function YesNoCheckbox({ form, editing, onChange }: { form: QuestionForm; editing: boolean; onChange: (form: QuestionForm) => void }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={form.yesNo}
          disabled={editing}
          aria-describedby={hintId}
          onCheckedChange={(checked) => onChange(edits.yesNo(form, checked === true))}
        />
        <label htmlFor={id} className="text-sm font-medium peer-disabled:opacity-60">
          Yes / No question
        </label>
      </div>
      <p id={hintId} className="pl-6 text-xs leading-normal text-muted-foreground">
        {editing
          ? "Set when the question was created."
          : "Two options with the reserved ids yes and no. Their labels stay editable."}
      </p>
    </div>
  );
}

function OpenQuestionEditor({ onOpenChange, question, onSaved }: Omit<QuestionEditorDialogProps, "open">) {
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
        aria-describedby={undefined}
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
            {form.type === "single_choice" && <YesNoCheckbox form={form} editing={editing} onChange={change} />}
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
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-muted px-5 py-3.5">
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
