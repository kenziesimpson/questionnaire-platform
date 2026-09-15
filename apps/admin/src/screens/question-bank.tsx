import type { Question, QuestionVersion } from "@qp/shared";
import { cn } from "@qp/ui/lib/utils";
import { Button } from "@qp/ui/primitives/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@qp/ui/primitives/table";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { questionQueries } from "../api/queries";
import { ArchiveQuestionDialog } from "./question-bank/archive-question-dialog";
import { bankCountLabel, isArchived, sortByLatestEdit } from "./question-bank/bank-display";
import { UsageCell } from "./question-bank/usage-cell";
import { PlusIcon } from "./question-editor/icons";
import { RESPONSE_TYPE_LABELS } from "./question-editor/question-form";
import { QuestionEditorDialog } from "./question-editor/question-editor-dialog";
import { fullTimestamp, lastEditedLabel } from "./questionnaire-list/summary-display";

type EditorTarget = { mode: "closed" } | { mode: "create" } | { mode: "edit"; question: QuestionVersion };

function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5.5 w-fit items-center rounded-full border border-border bg-background px-2 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

function QuestionRow({
  question,
  loadedAt,
  onEdit,
}: {
  question: Question;
  loadedAt: number;
  onEdit: (question: QuestionVersion) => void;
}) {
  const archived = isArchived(question);
  const { latest } = question;

  return (
    <TableRow className={cn(archived && "bg-muted/40")}>
      <TableCell className="py-3 pl-4 whitespace-normal">
        <div className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("font-medium", archived && "text-muted-foreground")}>{latest.prompt}</span>
            {question.archivedAt === null ? null : (
              <Pill className="border-dashed text-muted-foreground">
                <span title={`Archived ${fullTimestamp(question.archivedAt)}`}>Archived</span>
              </Pill>
            )}
          </span>
          {question.key === null ? null : <span className="font-mono text-xs text-muted-foreground">{question.key}</span>}
        </div>
      </TableCell>
      <TableCell>
        <Pill className={cn(archived && "text-muted-foreground")}>{RESPONSE_TYPE_LABELS[latest.type]}</Pill>
      </TableCell>
      <TableCell className="font-mono text-xs">v{latest.questionVersion}</TableCell>
      <TableCell className="text-muted-foreground">
        <time dateTime={latest.createdAt} title={fullTimestamp(latest.createdAt)}>
          {lastEditedLabel(latest.createdAt, loadedAt)}
        </time>
      </TableCell>
      <TableCell className="whitespace-normal">
        <UsageCell question={question} />
      </TableCell>
      <TableCell className="pr-4">
        {archived ? null : (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => onEdit(latest)} aria-label={`Edit ${latest.prompt}`}>
              Edit
            </Button>
            <ArchiveQuestionDialog question={question} />
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function QuestionTable({
  questions,
  loadedAt,
  onEdit,
}: {
  questions: Question[];
  loadedAt: number;
  onEdit: (question: QuestionVersion) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableCaption className="sr-only">Questions, most recently changed first</TableCaption>
          <TableHeader className="bg-muted">
            <TableRow className="hover:bg-muted">
              <TableHead className="pl-4 text-xs text-muted-foreground">Question</TableHead>
              <TableHead className="text-xs text-muted-foreground">Type</TableHead>
              <TableHead className="text-xs text-muted-foreground">Latest</TableHead>
              <TableHead className="text-xs text-muted-foreground" aria-sort="descending">
                Last changed
              </TableHead>
              <TableHead className="text-xs text-muted-foreground">Used by</TableHead>
              <TableHead className="pr-4 text-xs text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortByLatestEdit(questions).map((question) => (
              <QuestionRow key={question.questionId} question={question} loadedAt={loadedAt} onEdit={onEdit} />
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs leading-normal text-muted-foreground">
        Used by lists published versions, not drafts, so a draft can still contain a question shown as unused here.
        Nothing is deleted: an archived question stays in this list, marked, and every published version using it is
        unchanged.
      </p>
    </div>
  );
}

function Panel({ children, role }: { children: ReactNode; role?: "status" | "alert" }) {
  return (
    <div role={role} className="flex flex-col items-center gap-3 rounded-lg border border-border px-6 py-12 text-center">
      {children}
    </div>
  );
}

export function QuestionBankScreen() {
  const list = useQuery(questionQueries.list(true));
  const questions = list.data;
  const [editor, setEditor] = useState<EditorTarget>({ mode: "closed" });

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Question bank</h1>
          <p className="text-sm text-muted-foreground">
            Every question is reusable. Saving one writes a new version; older versions stay exactly as published.
          </p>
          <p className="min-h-5 text-sm text-muted-foreground">
            {questions === undefined ? null : `${bankCountLabel(questions)} · most recently changed first`}
          </p>
        </div>
        <Button type="button" onClick={() => setEditor({ mode: "create" })}>
          <PlusIcon />
          New question
        </Button>
      </div>

      {questions === undefined && list.isError ? (
        <Panel role="alert">
          <p className="font-medium">The question bank could not be loaded.</p>
          <Button variant="outline" onClick={() => void list.refetch()} disabled={list.isFetching}>
            Try again
          </Button>
        </Panel>
      ) : questions === undefined ? (
        <Panel role="status">
          <p className="text-muted-foreground">Loading questions…</p>
        </Panel>
      ) : questions.length === 0 ? (
        <Panel>
          <p className="font-medium">No questions yet</p>
          <p className="text-muted-foreground">
            Create one with New question. It can then be added to any questionnaire's draft.
          </p>
        </Panel>
      ) : (
        <QuestionTable
          questions={questions}
          loadedAt={list.dataUpdatedAt}
          onEdit={(question) => setEditor({ mode: "edit", question })}
        />
      )}

      <QuestionEditorDialog
        open={editor.mode !== "closed"}
        question={editor.mode === "edit" ? editor.question : undefined}
        onOpenChange={(open) => {
          if (!open) setEditor({ mode: "closed" });
        }}
        onSaved={() => undefined}
      />
    </section>
  );
}
