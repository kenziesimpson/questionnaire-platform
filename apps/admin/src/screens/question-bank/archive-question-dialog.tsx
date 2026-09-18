import type { Question } from "@qp/shared";
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
import { useState } from "react";
import { useArchiveQuestion } from "../../api/mutations/use-archive-question";
import { isProblem } from "../../api/problem-error";

function archiveFailureMessage(error: Error): string {
  if (isProblem(error, "resource/not-found")) return "This question no longer exists, so nothing was archived.";
  return "The question was not archived. Check the connection and try again.";
}

export function ArchiveQuestionDialog({ question }: { question: Question }) {
  const [open, setOpen] = useState(false);
  const archive = useArchiveQuestion();
  const prompt = question.latest.prompt;

  const changeOpen = (next: boolean) => {
    if (!next && archive.isPending) return;
    setOpen(next);
    archive.reset();
  };

  const confirm = () => {
    archive.mutate(question.questionId, { onSuccess: () => setOpen(false) });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Archive ${prompt}`}>
          Archive
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={!archive.isPending}>
        <DialogHeader>
          <DialogTitle>Archive this question?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{prompt}</span> stays in the bank, marked archived, and can
            no longer be added to a draft. Published versions that use it are not changed. There is no way to restore
            it from here.
          </DialogDescription>
        </DialogHeader>
        {archive.error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {archiveFailureMessage(archive.error)}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={archive.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" disabled={archive.isPending} onClick={confirm}>
            {archive.isPending ? "Archiving…" : "Archive question"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
