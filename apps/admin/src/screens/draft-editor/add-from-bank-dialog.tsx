import type { Question, QuestionVersion, QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@qp/ui/primitives/dialog";
import { useQuery } from "@tanstack/react-query";
import { questionQueries } from "../../api/queries";
import { RESPONSE_TYPE_LABELS } from "../question-editor/question-form";
import { isPlaced } from "./draft-changes";

export interface AddFromBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: QuestionnaireDraft;
  onAdd: (question: QuestionVersion) => void;
}

function newestFirst(questions: readonly Question[]): Question[] {
  return [...questions].sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}

function BankRow({ question, placed, onAdd }: { question: Question; placed: boolean; onAdd: () => void }) {
  const { latest } = question;
  return (
    <li className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{latest.prompt}</span>
        <span className="text-xs text-muted-foreground">
          {RESPONSE_TYPE_LABELS[latest.type]} · version {latest.questionVersion}
        </span>
      </div>
      {placed ? (
        <span className="text-xs text-muted-foreground">In this draft</span>
      ) : (
        <Button type="button" variant="outline" size="sm" aria-label={`Add “${latest.prompt}”, version ${latest.questionVersion}`} onClick={onAdd}>
          Add
        </Button>
      )}
    </li>
  );
}

function BankList({ draft, onAdd }: Pick<AddFromBankDialogProps, "draft" | "onAdd">) {
  const bank = useQuery(questionQueries.list(false));
  if (bank.isPending) {
    return (
      <p role="status" className="px-5 py-6 text-sm text-muted-foreground">
        Loading the question bank…
      </p>
    );
  }
  if (bank.isError) {
    return (
      <div className="flex flex-col items-start gap-3 px-5 py-6">
        <p role="alert" className="text-sm font-medium">
          The question bank could not be loaded.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void bank.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (bank.data.length === 0) {
    return <p className="px-5 py-6 text-sm text-muted-foreground">The bank has no active questions yet. Use New question to write one.</p>;
  }
  return (
    <ul aria-label="Active questions in the bank" className="flex min-h-0 flex-col overflow-y-auto">
      {newestFirst(bank.data).map((question) => (
        <BankRow
          key={question.questionId}
          question={question}
          placed={isPlaced(draft, question.questionId)}
          onAdd={() => onAdd(question.latest)}
        />
      ))}
    </ul>
  );
}

export function AddFromBankDialog({ open, onOpenChange, draft, onAdd }: AddFromBankDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-16 flex max-h-[calc(100svh-5rem)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <div className="flex flex-col gap-1 border-b border-border py-4 pr-12 pl-5">
          <DialogTitle className="text-base font-semibold tracking-tight">Add from the question bank</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            The item pins the version shown here. Later edits in the bank do not change it.
          </DialogDescription>
        </div>
        {open && <BankList draft={draft} onAdd={onAdd} />}
      </DialogContent>
    </Dialog>
  );
}
