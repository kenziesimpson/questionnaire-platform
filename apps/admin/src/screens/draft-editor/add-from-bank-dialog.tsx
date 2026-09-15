import type { Question, QuestionVersion, QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@qp/ui/primitives/dialog";
import { useQuery } from "@tanstack/react-query";
import { questionQueries } from "../../api/queries";
import { PlusIcon } from "../../components/icons";
import { Pill } from "../../components/pill";
import { sortByLatestEdit } from "../question-bank/bank-display";
import { QuestionEditorDialog } from "../question-editor/question-editor-dialog";
import { RESPONSE_TYPE_LABELS } from "../question-editor/question-form";
import { useQuestionEditor } from "../question-editor/use-question-editor";
import { lastEditedLabel } from "../questionnaire-list/summary-display";
import { isPlaced } from "./draft-changes";

export interface AddFromBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: QuestionnaireDraft;
  onAdd: (question: QuestionVersion) => void;
}

function BankRow({
  question,
  placed,
  loadedAt,
  onAdd,
}: {
  question: Question;
  placed: boolean;
  loadedAt: number;
  onAdd: () => void;
}) {
  const { latest } = question;
  return (
    <li className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-medium">{latest.prompt}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Pill>{RESPONSE_TYPE_LABELS[latest.type]}</Pill>
          <span className="font-mono">v{latest.questionVersion}</span>
          <span>
            changed <time dateTime={latest.createdAt}>{lastEditedLabel(latest.createdAt, loadedAt)}</time>
          </span>
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

function NewQuestionButton({ onClick, variant }: { onClick: () => void; variant: "default" | "outline" }) {
  return (
    <Button type="button" variant={variant} onClick={onClick}>
      <PlusIcon />
      New question
    </Button>
  );
}

function CreateStrip({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-5 py-3">
      <span className="text-sm">Not in the bank yet? Write it here and it is added to this draft.</span>
      <NewQuestionButton variant="outline" onClick={onCreate} />
    </div>
  );
}

function BankList({ draft, onAdd, onCreate }: Pick<AddFromBankDialogProps, "draft" | "onAdd"> & { onCreate: () => void }) {
  const bank = useQuery(questionQueries.list(false));
  if (bank.isPending) {
    return (
      <>
        <CreateStrip onCreate={onCreate} />
        <p role="status" className="px-5 py-6 text-sm text-muted-foreground">
          Loading the question bank…
        </p>
      </>
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
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
        <p className="font-medium">The bank has no active questions yet</p>
        <p className="text-sm text-muted-foreground">Write one now. It is saved to the bank and added to this draft.</p>
        <NewQuestionButton variant="default" onClick={onCreate} />
      </div>
    );
  }
  return (
    <>
      <CreateStrip onCreate={onCreate} />
      <ul aria-label="Active questions in the bank" className="flex min-h-0 flex-col overflow-y-auto">
        {sortByLatestEdit(bank.data).map((question) => (
          <BankRow
            key={question.questionId}
            question={question}
            placed={isPlaced(draft, question.questionId)}
            loadedAt={bank.dataUpdatedAt}
            onAdd={() => onAdd(question.latest)}
          />
        ))}
      </ul>
    </>
  );
}

export function AddFromBankDialog({ open, onOpenChange, draft, onAdd }: AddFromBankDialogProps) {
  const editor = useQuestionEditor();
  const create = () => editor.create(onAdd);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-16 flex max-h-[calc(100svh-5rem)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
        <div className="flex flex-col gap-1 border-b border-border py-4 pr-12 pl-5">
          <DialogTitle className="text-base font-semibold tracking-tight">Add a question</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Pick one from the bank, or write a new one. The item pins the version shown here; later edits in the bank do
            not change it.
          </DialogDescription>
        </div>
        {open && <BankList draft={draft} onAdd={onAdd} onCreate={create} />}
        <QuestionEditorDialog {...editor.dialogProps} />
      </DialogContent>
    </Dialog>
  );
}
