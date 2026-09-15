import type { DraftItem, QuestionVersion, QuestionnaireDraft, QuestionnaireSummary } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useId, useState, type ReactNode } from "react";
import { isProblem } from "../api/problem-error";
import { questionQueries, questionnaireQueries } from "../api/queries";
import { useDraftMutation, type DraftChange } from "../api/use-draft-mutation";
import { useOpenDraft } from "../api/use-open-draft";
import { AddFromBankDialog } from "./draft-editor/add-from-bank-dialog";
import { addItem, repinItem } from "./draft-editor/draft-changes";
import { DraftItems, itemDomId } from "./draft-editor/draft-items";
import { DraftRejectionNotice, type DraftWrite } from "./draft-editor/draft-rejection-notice";
import { ArrowLeftIcon } from "./draft-editor/icons";
import { PublishChecksPanel, type PublishChecks } from "./draft-editor/publish-checks-panel";
import { PlusIcon } from "./question-editor/icons";
import { QuestionEditorDialog } from "./question-editor/question-editor-dialog";

const route = getRouteApi("/questionnaires/$questionnaireId/draft");

function BackToQuestionnaires() {
  return (
    <Button asChild variant="ghost" size="icon-sm">
      <Link to="/questionnaires" aria-label="Back to questionnaires" title="Back to questionnaires">
        <ArrowLeftIcon />
      </Link>
    </Button>
  );
}

function publishFacts(summary: QuestionnaireSummary | undefined) {
  if (summary === undefined) return null;
  if (summary.currentVersion === null) return "never published · publishing creates version 1";
  return `published v${summary.currentVersion} · publishing creates v${summary.currentVersion + 1}`;
}

function Notice({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className="flex flex-col items-start gap-3 rounded-xl border border-border px-4 py-6 text-sm"
    >
      {children}
    </div>
  );
}

function questionCount(count: number) {
  return count === 1 ? "1 question" : `${count} questions`;
}

interface EditTarget {
  itemId: string;
  question: QuestionVersion;
}

function useEditInContext() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const start = async (item: DraftItem) => {
    setFailed(false);
    setLoadingItemId(item.itemId);
    try {
      const question = await queryClient.fetchQuery({ ...questionQueries.one(item.questionId), staleTime: 0 });
      setTarget({ itemId: item.itemId, question: question.latest });
    } catch {
      setFailed(true);
    } finally {
      setLoadingItemId(null);
    }
  };

  return { target, loadingItemId, failed, start, close: () => setTarget(null), dismissFailure: () => setFailed(false) };
}

function DraftEditor({
  questionnaireId,
  draft,
  summary,
}: {
  questionnaireId: string;
  draft: QuestionnaireDraft;
  summary: QuestionnaireSummary | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useDraftMutation(questionnaireId);
  const validation = useQuery(questionnaireQueries.draftValidation(questionnaireId));
  const bank = useQuery(questionQueries.list(true));
  const edit = useEditInContext();
  const [lastWrite, setLastWrite] = useState<DraftWrite>("change");
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const publishHintId = useId();
  const bankById = new Map((bank.data ?? []).map((question) => [question.questionId, question]));

  const change = (apply: DraftChange) => {
    mutation.dismissRejection();
    setLastWrite("change");
    mutation.change(apply);
  };

  const publish = async () => {
    mutation.dismissRejection();
    setLastWrite("publish");
    setPublishing(true);
    const published = await mutation.publish();
    if (published === null) {
      setPublishing(false);
      void queryClient.invalidateQueries({ queryKey: questionnaireQueries.draftValidation(questionnaireId).queryKey });
      return;
    }
    void navigate({ to: "/questionnaires/$questionnaireId/versions", params: { questionnaireId } });
  };

  const jumpToItem = (itemId: string) => {
    const row = document.getElementById(itemDomId(itemId));
    row?.scrollIntoView({ block: "center" });
    row?.focus();
  };

  const checks: PublishChecks = validation.isPending
    ? { status: "checking" }
    : validation.isError
      ? { status: "unavailable", retry: () => void validation.refetch() }
      : { status: "checked", problems: validation.data.items };
  const blockedByChecks = validation.isSuccess && !validation.data.valid;

  return (
    <>
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <BackToQuestionnaires />
            <h1 className="truncate text-xl font-semibold tracking-tight">{draft.title}</h1>
            <span className="inline-flex h-5 items-center rounded-full border border-border bg-muted px-2 text-[11px] font-medium">
              Draft
            </span>
            {publishFacts(summary) !== null && <span className="text-xs text-muted-foreground">{publishFacts(summary)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span role="status" className="text-xs text-muted-foreground">
              {mutation.isSaving ? "Saving…" : "All changes saved"}
            </span>
            {summary !== undefined && summary.currentVersion !== null && (
              <Button asChild variant="outline">
                <Link to="/questionnaires/$questionnaireId/versions" params={{ questionnaireId }}>
                  Version history
                </Link>
              </Button>
            )}
            <Button
              type="button"
              disabled={publishing || blockedByChecks}
              aria-describedby={blockedByChecks ? publishHintId : undefined}
              onClick={() => void publish()}
            >
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
        {blockedByChecks && (
          <p id={publishHintId} className="text-right text-xs text-muted-foreground">
            Publishing is blocked until the publish checks pass.
          </p>
        )}
      </header>

      {mutation.rejection !== null && (
        <DraftRejectionNotice
          rejection={mutation.rejection}
          write={lastWrite}
          draft={draft}
          onDismiss={mutation.dismissRejection}
        />
      )}

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <section aria-labelledby="draft-items-heading" className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="draft-items-heading" className="text-[13px] font-semibold">
              {questionCount(draft.items.length)}
            </h2>
            <span className="text-xs text-muted-foreground">Drag or use the arrows to reorder · this is the order respondents see</span>
          </div>
          {edit.failed && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <span>The question could not be loaded for editing. Try again.</span>
              <Button type="button" variant="outline" size="sm" onClick={edit.dismissFailure}>
                Dismiss
              </Button>
            </div>
          )}
          {draft.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No questions yet. Add one from the bank, or write a new one.
            </p>
          ) : (
            <DraftItems
              draft={draft}
              bank={bankById}
              onChange={change}
              onEdit={(item) => void edit.start(item)}
              editingItemId={edit.loadingItemId}
            />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon />
              Add from bank
            </Button>
            <Button type="button" variant="outline" onClick={() => setCreating(true)}>
              New question
            </Button>
          </div>
        </section>
        <aside aria-label="Publishing" className="flex w-full shrink-0 flex-col gap-3 xl:w-80">
          <PublishChecksPanel draft={draft} checks={checks} onJumpToItem={jumpToItem} />
        </aside>
      </div>

      <AddFromBankDialog
        open={adding}
        onOpenChange={setAdding}
        draft={draft}
        onAdd={(question) => {
          change(addItem(question));
          setAdding(false);
        }}
      />
      <QuestionEditorDialog open={creating} onOpenChange={setCreating} onSaved={(saved) => change(addItem(saved))} />
      <QuestionEditorDialog
        key={edit.target?.itemId}
        open={edit.target !== null}
        onOpenChange={(open) => {
          if (!open) edit.close();
        }}
        question={edit.target?.question}
        onSaved={(saved) => {
          if (edit.target !== null) change(repinItem(edit.target.itemId, saved));
        }}
      />
    </>
  );
}

function NoOpenDraft({ questionnaireId, summary }: { questionnaireId: string; summary: QuestionnaireSummary }) {
  const { openDraft, openingId, failure } = useOpenDraft();
  const opening = openingId === questionnaireId;
  return (
    <Notice>
      <p className="font-medium">{summary.name} has no open draft.</p>
      <p className="text-muted-foreground">
        {summary.currentVersion === null
          ? "There is nothing to edit here."
          : `Opening the next draft copies version ${summary.currentVersion}, so it can be changed and published as version ${summary.currentVersion + 1}.`}
      </p>
      {failure !== null && (
        <p role="alert" className="text-destructive">
          The draft could not be opened. Try again.
        </p>
      )}
      <div className="flex gap-2">
        {summary.currentVersion !== null && (
          <Button type="button" disabled={opening} onClick={() => openDraft(summary)}>
            {opening ? "Opening…" : "Open the next draft"}
          </Button>
        )}
        <Button asChild variant="outline">
          <Link to="/questionnaires">Back to questionnaires</Link>
        </Button>
      </div>
    </Notice>
  );
}

function MissingDraft({ questionnaireId }: { questionnaireId: string }) {
  const list = useQuery(questionnaireQueries.list());
  const summary = list.data?.find((candidate) => candidate.questionnaireId === questionnaireId);
  if (list.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading draft…
      </p>
    );
  }
  if (summary === undefined) {
    return (
      <Notice>
        <p className="font-medium">This questionnaire does not exist.</p>
        <Link to="/questionnaires" className="font-medium underline underline-offset-4">
          Back to questionnaires
        </Link>
      </Notice>
    );
  }
  return <NoOpenDraft questionnaireId={questionnaireId} summary={summary} />;
}

export function DraftEditorScreen() {
  const { questionnaireId } = route.useParams();
  const draft = useQuery(questionnaireQueries.draft(questionnaireId));
  const list = useQuery(questionnaireQueries.list());
  const summary = list.data?.find((candidate) => candidate.questionnaireId === questionnaireId);

  if (draft.isSuccess) {
    return <DraftEditor questionnaireId={questionnaireId} draft={draft.data.draft} summary={summary} />;
  }

  const body = (() => {
    if (draft.isPending) {
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Loading draft…
        </p>
      );
    }
    if (isProblem(draft.error, "resource/not-found")) return <MissingDraft questionnaireId={questionnaireId} />;
    return (
      <Notice alert>
        <p className="font-medium">The draft could not be loaded.</p>
        <Button variant="outline" size="sm" disabled={draft.isFetching} onClick={() => void draft.refetch()}>
          {draft.isFetching ? "Retrying…" : "Try again"}
        </Button>
      </Notice>
    );
  })();

  return (
    <>
      <header className="flex items-center gap-2.5">
        <BackToQuestionnaires />
        <h1 className="text-xl font-semibold tracking-tight">{summary?.name ?? "Draft editor"}</h1>
      </header>
      {body}
    </>
  );
}
