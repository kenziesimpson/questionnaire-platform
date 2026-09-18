import type { QuestionnaireSummary } from "@qp/shared";
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
import { useState, type FormEvent } from "react";
import { useSetClosesAt } from "../../api/mutations/use-set-closes-at";
import { InputField } from "../../components/field";
import type { FieldErrors } from "../../features/question-editor/field-errors";
import { fromLocalDateTimeInput, toLocalDateTimeInput } from "./summary-display";

const NO_ERRORS: FieldErrors = {};

type ClosingAction = "Retire" | "Reopen" | "Reschedule";

function closingActionOf(summary: QuestionnaireSummary, closed: boolean): ClosingAction {
  if (summary.closesAt === null) return "Retire";
  return closed ? "Reopen" : "Reschedule";
}

export function ClosesAtDialog({ summary, closed }: { summary: QuestionnaireSummary; closed: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const action = closingActionOf(summary, closed);

  const save = useSetClosesAt(summary.questionnaireId);
  const errors: FieldErrors =
    showMissing && fromLocalDateTimeInput(value) === null ? { "/closesAt": ["Enter a date and time."] } : NO_ERRORS;

  const changeOpen = (next: boolean) => {
    setOpen(next);
    setShowMissing(false);
    save.reset();
    if (next) setValue(toLocalDateTimeInput(summary.closesAt === null ? Date.now() : Date.parse(summary.closesAt)));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const closesAt = fromLocalDateTimeInput(value);
    if (closesAt === null) {
      setShowMissing(true);
      return;
    }
    save.mutate(closesAt, { onSuccess: () => setOpen(false) });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${action} ${summary.name}`}>
          {action}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {action} {summary.name}
            </DialogTitle>
            <DialogDescription>
              Respondents cannot start or submit it once the closing date passes. Clearing the date reopens it.
            </DialogDescription>
          </DialogHeader>
          <InputField
            label="Closes at"
            pointer="/closesAt"
            errors={errors}
            width="w-full"
            type="datetime-local"
            hint="Your local time. A time that has already passed closes it straight away."
            value={value}
            onValue={setValue}
          />
          {save.isError ? (
            <p role="alert" className="text-sm text-destructive">
              The closing date was not saved. Try again.
            </p>
          ) : null}
          <DialogFooter>
            {summary.closesAt !== null ? (
              <Button
                type="button"
                variant={closed ? "default" : "outline"}
                className="sm:mr-auto"
                disabled={save.isPending}
                onClick={() => save.mutate(null, { onSuccess: () => setOpen(false) })}
              >
                Clear closing date
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant={closed ? "outline" : "default"} disabled={save.isPending}>
              Save closing date
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
