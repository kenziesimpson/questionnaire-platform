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
import { Input } from "@qp/ui/primitives/input";
import { Label } from "@qp/ui/primitives/label";
import { useId, useState, type FormEvent } from "react";
import { useSetClosesAt } from "../../api/mutations/use-set-closes-at";
import { fromLocalDateTimeInput, toLocalDateTimeInput } from "./summary-display";

type ClosingAction = "Retire" | "Reopen" | "Reschedule";

function closingActionOf(summary: QuestionnaireSummary, closed: boolean): ClosingAction {
  if (summary.closesAt === null) return "Retire";
  return closed ? "Reopen" : "Reschedule";
}

export function ClosesAtDialog({ summary, closed }: { summary: QuestionnaireSummary; closed: boolean }) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const action = closingActionOf(summary, closed);

  const save = useSetClosesAt(summary.questionnaireId);

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

  const missing = showMissing && fromLocalDateTimeInput(value) === null;

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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>Closes at</Label>
            <Input
              id={inputId}
              type="datetime-local"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-invalid={missing || undefined}
              aria-describedby={missing ? `${inputId}-hint ${inputId}-error` : `${inputId}-hint`}
            />
            <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
              Your local time. A time that has already passed closes it straight away.
            </p>
            {missing ? (
              <p id={`${inputId}-error`} className="text-xs text-destructive">
                Enter a date and time.
              </p>
            ) : null}
          </div>
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
