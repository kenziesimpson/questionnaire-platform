import type { QuestionnaireDraft, QuestionnaireSummary } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { isProblem } from "../api/problem-error";
import { questionQueries, questionnaireQueries } from "../api/queries";
import { useDraftMutation, type DraftChange } from "../api/use-draft-mutation";
import { useOpenDraft } from "../api/use-open-draft";
import { BackToQuestionnaires } from "../components/back-to-questionnaires";
import { problemCount, questionCount } from "../components/counts";
import { PlusIcon } from "../components/icons";
import { Notice } from "../components/notice";
import { QuestionnaireNotFound } from "../components/questionnaire-not-found";
import { AddFromBankDialog } from "./draft-editor/add-from-bank-dialog";
import { addItem, repinItem } from "./draft-editor/draft-changes";
import { DraftItems, itemDomId, rulesEditorOf } from "./draft-editor/draft-items";
import { DraftRejectionNotice, type DraftWrite } from "./draft-editor/draft-rejection-notice";
import { PublishChecksPanel, type JumpOptions, type PublishChecks } from "./draft-editor/publish-checks-panel";
import { QuestionEditorDialog } from "./question-editor/question-editor-dialog";
import { useQuestionEditor } from "./question-editor/use-question-editor";

const route = getRouteApi("/questionnaires/$questionnaireId/draft");

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function publishFacts(summary: QuestionnaireSummary | undefined) {
  if (summary === undefined) return null;
  if (summary.currentVersion === null) return "never published · publishing creates version 1";
  return `published v${summary.currentVersion} · publishing creates v${summary.currentVersion + 1}`;
}

function DraftHeading({ summary, summaryPending }: { summary: QuestionnaireSummary | undefined; summaryPending: boolean }) {
  if (summary === undefined && summaryPending) {
    return (
      <h1 className="text-xl font-semibold tracking-tight">
        <span className="sr-only">Draft editor</span>
        <span aria-hidden="true" className="block h-6 w-48 animate-pulse rounded-md bg-muted" />
      </h1>
    );
  }
  return <h1 className="truncate text-xl font-semibold tracking-tight">{summary?.name ?? "Draft editor"}</h1>;
}

interface PublishHint {
  lead: string;
  linksToChecks: boolean;
  trail: string;
}

function publishWaitsFor({
  saving,
  checking,
  checksFailed,
  problems,
}: {
  saving: boolean;
  checking: boolean;
  checksFailed: boolean;
  problems: number;
}): PublishHint | null {
  if (saving) return { lead: "Publishing waits until your changes are saved.", linksToChecks: false, trail: "" };
  if (checking) return { lead: "Publishing waits until ", linksToChecks: true, trail: " have run on the saved draft." };
  if (checksFailed) return { lead: "Publishing waits until ", linksToChecks: true, trail: " can run." };
  if (problems > 0) {
    return { lead: `${problemCount(problems)} under `, linksToChecks: true, trail: ` ${problems === 1 ? "is" : "are"} blocking publishing.` };
  }
  return null;
}

function DraftEditor({
  questionnaireId,
  draft,
  summary,
  summaryPending,
}: {
  questionnaireId: string;
  draft: QuestionnaireDraft;
  summary: QuestionnaireSummary | undefined;
  summaryPending: boolean;
}) {
  const navigate = useNavigate();
  const mutation = useDraftMutation(questionnaireId);
  const validation = useQuery(questionnaireQueries.draftValidation(questionnaireId));
  const bank = useQuery(questionQueries.list(true));
  const editor = useQuestionEditor();
  const [lastWrite, setLastWrite] = useState<DraftWrite>("change");
  const [adding, setAdding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [openRules, setOpenRules] = useState<ReadonlySet<string>>(() => new Set());
  const [jumpedItemId, setJumpedItemId] = useState<string | null>(null);
  const checksHeading = useRef<HTMLHeadingElement>(null);
  const publishHintId = useId();
  const bankById = new Map((bank.data ?? []).map((question) => [question.questionId, question]));

  const change = (apply: DraftChange) => {
    mutation.dismissRejection();
    setLastWrite("change");
    mutation.change(apply);
  };

  const focusChecks = () => checksHeading.current?.focus();

  const publish = async () => {
    mutation.dismissRejection();
    setLastWrite("publish");
    setPublishing(true);
    const outcome = await mutation.publish();
    if (outcome.kind === "published") {
      void navigate({ to: "/questionnaires/$questionnaireId/versions", params: { questionnaireId } });
      return;
    }
    setPublishing(false);
    if (outcome.kind === "refused" && outcome.rejection.kind === "invalid") focusChecks();
  };

  const setRulesOpen = (itemId: string, open: boolean) =>
    setOpenRules((current) => {
      const next = new Set(current);
      if (open) next.add(itemId);
      else next.delete(itemId);
      return next;
    });

  const jumpToItem = (itemId: string, { openRules: withRules }: JumpOptions) => {
    flushSync(() => {
      if (withRules) setRulesOpen(itemId, true);
      setJumpedItemId(itemId);
    });
    const row = document.getElementById(itemDomId(itemId));
    if (row === null) return;
    row.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    ((withRules ? rulesEditorOf(itemId) : null) ?? row).focus({ preventScroll: true });
  };

  const checksBusy = validation.isFetching || mutation.isSaving;
  const checks: PublishChecks = validation.isPending
    ? { status: "checking" }
    : validation.isError
      ? { status: "unavailable", retry: () => void validation.refetch(), retrying: validation.isFetching }
      : { status: "checked", problems: validation.data.items, refreshing: checksBusy };
  const publishHint = publishWaitsFor({
    saving: mutation.isSaving,
    checking: validation.isPending || validation.isFetching,
    checksFailed: validation.isError,
    problems: validation.isSuccess ? validation.data.items.length : 0,
  });
  const nextVersion = summary === undefined ? undefined : (summary.currentVersion ?? 0) + 1;

  return (
    <>
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <BackToQuestionnaires />
            <DraftHeading summary={summary} summaryPending={summaryPending} />
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
              disabled={publishing || publishHint !== null}
              aria-describedby={publishHint === null ? undefined : publishHintId}
              onClick={() => void publish()}
            >
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
        {publishHint !== null && (
          <p id={publishHintId} className="text-right text-xs text-muted-foreground">
            {publishHint.lead}
            {publishHint.linksToChecks && (
              <Button type="button" variant="link" className="h-auto p-0 text-xs text-foreground" onClick={focusChecks}>
                Publish checks
              </Button>
            )}
            {publishHint.trail}
          </p>
        )}
      </header>

      {mutation.rejection !== null && (
        <DraftRejectionNotice
          rejection={mutation.rejection}
          write={lastWrite}
          draft={draft}
          onShowProblems={focusChecks}
          onDismiss={mutation.dismissRejection}
        />
      )}

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <aside
          aria-label="Publishing"
          className="flex w-full shrink-0 flex-col gap-3 xl:sticky xl:top-6 xl:order-last xl:max-h-[calc(100svh-3rem)] xl:w-80"
        >
          <PublishChecksPanel
            draft={draft}
            checks={checks}
            nextVersion={nextVersion}
            headingRef={checksHeading}
            activeItemId={jumpedItemId}
            onJumpToItem={jumpToItem}
          />
        </aside>
        <section aria-labelledby="draft-items-heading" className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="draft-items-heading" className="text-[13px] font-semibold">
              {questionCount(draft.items.length)}
            </h2>
          </div>
          {draft.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No questions yet. Add one from the bank, or write a new one from the same dialog.
            </p>
          ) : (
            <DraftItems
              draft={draft}
              bank={bankById}
              openRules={openRules}
              jumpedItemId={jumpedItemId}
              onRulesOpenChange={setRulesOpen}
              onJumpEnd={(itemId) => setJumpedItemId((current) => (current === itemId ? null : current))}
              onChange={change}
              onEdit={(item, latest) => editor.edit(latest, (saved) => change(repinItem(item.itemId, saved)))}
              locked={publishing}
            />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={publishing} onClick={() => setAdding(true)}>
              <PlusIcon />
              Add question
            </Button>
          </div>
        </section>
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
      <QuestionEditorDialog {...editor.dialogProps} />
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
          <Link to="/questionnaires" activeOptions={{ exact: true }}>
            Back to questionnaires
          </Link>
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
      <QuestionnaireNotFound />
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
    return (
      <DraftEditor questionnaireId={questionnaireId} draft={draft.data.draft} summary={summary} summaryPending={list.isPending} />
    );
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
        <DraftHeading summary={summary} summaryPending={list.isPending} />
      </header>
      {body}
    </>
  );
}
