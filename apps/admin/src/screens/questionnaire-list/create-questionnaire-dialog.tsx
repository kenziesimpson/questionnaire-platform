import { Button } from "@qp/ui/primitives/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@qp/ui/primitives/dialog";
import { useRef, useState, type FormEvent } from "react";
import { useCreateQuestionnaire, type NewQuestionnaire } from "../../api/mutations/use-create-questionnaire";
import { InputField } from "../../components/field";
import type { FieldErrors } from "../../features/question-editor/field-errors";
import { PlusIcon } from "../../components/icons";

const NO_ERRORS: FieldErrors = {};

function missingEntries(fields: NewQuestionnaire): FieldErrors {
  const errors: FieldErrors = {};
  if (fields.name.trim() === "") errors["/name"] = ["Enter a name."];
  if (fields.title.trim() === "") errors["/title"] = ["Enter a title."];
  return errors;
}

export function CreateQuestionnaireDialog() {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<NewQuestionnaire>({ name: "", title: "" });
  const [showErrors, setShowErrors] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const create = useCreateQuestionnaire();
  const errors = showErrors ? missingEntries(fields) : NO_ERRORS;

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) return;
    setFields({ name: "", title: "" });
    setShowErrors(false);
    create.reset();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const missing = missingEntries(fields);
    if (Object.keys(missing).length > 0) {
      setShowErrors(true);
      (missing["/name"] !== undefined ? nameRef : titleRef).current?.focus();
      return;
    }
    create.mutate({ name: fields.name.trim(), title: fields.title.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon size={15} />
          New questionnaire
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New questionnaire</DialogTitle>
            <DialogDescription>Creating it opens draft version 1, where you add its questions.</DialogDescription>
          </DialogHeader>
          <InputField
            label="Name"
            pointer="/name"
            errors={errors}
            width="w-full"
            hint="What authors see in this list."
            value={fields.name}
            onValue={(name) => setFields((current) => ({ ...current, name }))}
            inputRef={nameRef}
            autoComplete="off"
          />
          <InputField
            label="Title"
            pointer="/title"
            errors={errors}
            width="w-full"
            hint="What respondents see. A later draft can change it."
            value={fields.title}
            onValue={(title) => setFields((current) => ({ ...current, title }))}
            inputRef={titleRef}
            autoComplete="off"
          />
          {create.isError ? (
            <p role="alert" className="text-sm text-destructive">
              The questionnaire was not created. Check the fields and try again.
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create questionnaire"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
