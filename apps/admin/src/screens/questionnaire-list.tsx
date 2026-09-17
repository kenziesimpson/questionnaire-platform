import type { QuestionnaireSummary } from "@qp/shared";
import { cn } from "@qp/ui/lib/utils";
import { Button } from "@qp/ui/primitives/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@qp/ui/primitives/table";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { questionnaireQueries } from "../api/queries";
import { useOpenDraft, type OpenDraft } from "../api/use-open-draft";
import { Panel } from "../components/panel";
import { Pill } from "../components/pill";
import { ClosesAtDialog } from "./questionnaire-list/closes-at-dialog";
import { CreateQuestionnaireDialog } from "./questionnaire-list/create-questionnaire-dialog";
import {
  closesLabel,
  fullTimestamp,
  lastEditedLabel,
  sortByMostRecentlyEdited,
  statusLabel,
  statusOf,
  type QuestionnaireStatus,
} from "./questionnaire-list/summary-display";

const LIST_REFRESH_MS = 60_000;

function countLabel(count: number): string {
  return count === 1 ? "1 questionnaire" : `${count} questionnaires`;
}

function StatusPill({ status }: { status: QuestionnaireStatus }) {
  const tone = {
    "never-published": "border-dashed text-muted-foreground",
    published: "",
    closed: "text-muted-foreground",
  }[status.kind];
  return <Pill className={tone}>{statusLabel(status)}</Pill>;
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function QuestionnaireRow({ summary, now, drafts }: { summary: QuestionnaireSummary; now: number; drafts: OpenDraft }) {
  const status = statusOf(summary, now);
  const closed = status.kind === "closed";
  const opening = drafts.openingId === summary.questionnaireId;

  return (
    <TableRow>
      <TableCell className="py-3 pl-4 whitespace-normal">
        <div className="flex flex-col gap-0.5">
          <span className={cn("font-medium", closed && "text-muted-foreground")}>{summary.name}</span>
          {summary.key === null ? null : (
            <span className="font-mono text-xs text-muted-foreground">{summary.key}</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <StatusPill status={status} />
      </TableCell>
      <TableCell>{summary.hasDraft ? <Pill className="bg-muted">Draft open</Pill> : <Muted>—</Muted>}</TableCell>
      <TableCell>
        <Muted>{closesLabel(summary)}</Muted>
      </TableCell>
      <TableCell>
        <Muted>
          <time dateTime={summary.updatedAt} title={fullTimestamp(summary.updatedAt)}>
            {lastEditedLabel(summary.updatedAt, now)}
          </time>
        </Muted>
      </TableCell>
      <TableCell className="pr-4">
        <div className="grid w-fit grid-cols-[6rem_4.5rem_6.5rem] items-center justify-items-start gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={drafts.openingId !== null}
            onClick={() => drafts.openDraft(summary)}
            aria-label={`Open draft of ${summary.name}`}
          >
            {opening ? "Opening…" : "Open draft"}
          </Button>
          {summary.currentVersion === null ? (
            <span />
          ) : (
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/questionnaires/$questionnaireId/versions"
                params={{ questionnaireId: summary.questionnaireId }}
                aria-label={`History of ${summary.name}`}
              >
                History
              </Link>
            </Button>
          )}
          <ClosesAtDialog summary={summary} closed={closed} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function OpenDraftFailureNotice({ drafts, summaries }: { drafts: OpenDraft; summaries: QuestionnaireSummary[] }) {
  if (drafts.failure === null) return null;
  const { questionnaireId } = drafts.failure;
  const name = summaries.find((summary) => summary.questionnaireId === questionnaireId)?.name ?? "this questionnaire";
  return (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-lg border border-destructive/40 px-4 py-3 text-sm">
      <span>The draft of {name} could not be opened. Try again.</span>
      <Button variant="ghost" size="sm" onClick={drafts.dismissFailure}>
        Dismiss
      </Button>
    </div>
  );
}

function QuestionnaireTable({ summaries, loadedAt }: { summaries: QuestionnaireSummary[]; loadedAt: number }) {
  const drafts = useOpenDraft();

  return (
    <>
      <OpenDraftFailureNotice drafts={drafts} summaries={summaries} />
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableCaption className="sr-only">Questionnaires, most recently edited first</TableCaption>
          <TableHeader className="bg-muted">
            <TableRow className="hover:bg-muted">
              <TableHead className="pl-4 text-xs text-muted-foreground">Name</TableHead>
              <TableHead className="text-xs text-muted-foreground">Status</TableHead>
              <TableHead className="text-xs text-muted-foreground">Draft</TableHead>
              <TableHead className="text-xs text-muted-foreground">Closes</TableHead>
              <TableHead className="text-xs text-muted-foreground" aria-sort="descending">
                Last edited
              </TableHead>
              <TableHead className="pr-4 text-xs text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortByMostRecentlyEdited(summaries).map((summary) => (
              <QuestionnaireRow key={summary.questionnaireId} summary={summary} now={loadedAt} drafts={drafts} />
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export function QuestionnaireListScreen() {
  const list = useQuery({ ...questionnaireQueries.list(), refetchInterval: LIST_REFRESH_MS });
  const summaries = list.data;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Questionnaires</h1>
          <p className="min-h-5 text-sm text-muted-foreground">
            {summaries === undefined ? null : `${countLabel(summaries.length)} · most recently edited first`}
          </p>
        </div>
        <CreateQuestionnaireDialog />
      </div>

      {summaries === undefined && list.isError ? (
        <Panel role="alert">
          <p className="font-medium">The questionnaires could not be loaded.</p>
          <Button variant="outline" onClick={() => void list.refetch()} disabled={list.isFetching}>
            Try again
          </Button>
        </Panel>
      ) : summaries === undefined ? (
        <Panel role="status">
          <p className="text-muted-foreground">Loading questionnaires…</p>
        </Panel>
      ) : summaries.length === 0 ? (
        <Panel>
          <p className="font-medium">No questionnaires yet</p>
          <p className="text-muted-foreground">Create one with New questionnaire. It starts as a draft you add questions to.</p>
        </Panel>
      ) : (
        <QuestionnaireTable summaries={summaries} loadedAt={list.dataUpdatedAt} />
      )}
    </section>
  );
}
