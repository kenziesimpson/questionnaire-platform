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
import { Input } from "@qp/ui/primitives/input";
import { Label } from "@qp/ui/primitives/label";
import { useId, useRef, useState, type FormEvent, type Ref } from "react";
import { useCreateQuestionnaire, type NewQuestionnaire } from "../../api/mutations/use-create-questionnaire";
import { PlusIcon } from "../../components/icons";

function RequiredField({
  label,
  hint,
  value,
  onChange,
  showMissing,
  inputRef,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  showMissing: boolean;
  inputRef: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const missing = showMissing && value.trim() === "";
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={missing || undefined}
        aria-describedby={missing ? `${id}-hint ${id}-error` : `${id}-hint`}
        autoComplete="off"
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {missing ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          Enter a {label.toLowerCase()}.
        </p>
      ) : null}
    </div>
  );
}

export function CreateQuestionnaireDialog() {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<NewQuestionnaire>({ name: "", title: "" });
  const [showMissing, setShowMissing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const create = useCreateQuestionnaire();

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) return;
    setFields({ name: "", title: "" });
    setShowMissing(false);
    create.reset();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = fields.name.trim();
    const title = fields.title.trim();
    if (name === "" || title === "") {
      setShowMissing(true);
      (name === "" ? nameRef : titleRef).current?.focus();
      return;
    }
    create.mutate({ name, title });
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
          <RequiredField
            label="Name"
            hint="What authors see in this list."
            value={fields.name}
            onChange={(name) => setFields((current) => ({ ...current, name }))}
            showMissing={showMissing}
            inputRef={nameRef}
          />
          <RequiredField
            label="Title"
            hint="What respondents see. A later draft can change it."
            value={fields.title}
            onChange={(title) => setFields((current) => ({ ...current, title }))}
            showMissing={showMissing}
            inputRef={titleRef}
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
