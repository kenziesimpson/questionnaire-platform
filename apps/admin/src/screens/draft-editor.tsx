import type { QuestionnaireDraft, QuestionnaireSummary } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { isProblem } from "../api/problem-error";
import { questionnaireQueries } from "../api/queries";
import { useQuestionnaireSummary } from "../api/use-questionnaire-summary";
import { BackToQuestionnaires } from "../components/back-to-questionnaires";
import { PlusIcon } from "../components/icons";
import { Notice } from "../components/notice";
import { QuestionEditorDialog } from "../features/question-editor/question-editor-dialog";
import { questionCount } from "../lib/counts";
import { AddFromBankDialog } from "./draft-editor/add-from-bank-dialog";
import { addItem, repinItem } from "./draft-editor/draft-changes";
import { DraftEditorHeader, DraftHeading } from "./draft-editor/draft-header";
import { DraftItems } from "./draft-editor/draft-items";
import { DraftRejectionNotice } from "./draft-editor/draft-rejection-notice";
import { MissingDraft } from "./draft-editor/no-open-draft";
import { PublishChecksPanel } from "./draft-editor/publish-checks-panel";
import { useDraftEditor } from "./draft-editor/use-draft-editor";

const route = getRouteApi("/questionnaires/$questionnaireId/draft");

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
  const editor = useDraftEditor(questionnaireId, summary);

  return (
    <>
      <DraftEditorHeader
        questionnaireId={questionnaireId}
        summary={summary}
        summaryPending={summaryPending}
        isSaving={editor.isSaving}
        publishing={editor.publishing}
        publishHint={editor.publishHint}
        publishHintId={editor.publishHintId}
        onFocusChecks={editor.focusChecks}
        onPublish={() => void editor.publish()}
      />

      {editor.rejection !== null && (
        <DraftRejectionNotice
          rejection={editor.rejection}
          write={editor.lastWrite}
          draft={draft}
          onShowProblems={editor.focusChecks}
          onDismiss={editor.dismissRejection}
        />
      )}

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <aside
          aria-label="Publishing"
          className="flex w-full shrink-0 flex-col gap-3 xl:sticky xl:top-6 xl:order-last xl:max-h-[calc(100svh-3rem)] xl:w-80"
        >
          <PublishChecksPanel
            draft={draft}
            checks={editor.checks}
            nextVersion={editor.nextVersion}
            headingRef={editor.checksHeadingRef}
            activeItemId={editor.jumpedItemId}
            onJumpToItem={editor.jumpToItem}
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
              bank={editor.bankById}
              openRules={editor.openRules}
              jumpedItemId={editor.jumpedItemId}
              onRulesOpenChange={editor.setRulesOpen}
              onJumpEnd={editor.onJumpEnd}
              onChange={editor.change}
              onEdit={(item, latest) => editor.questionEditor.edit(latest, (saved) => editor.change(repinItem(item.itemId, saved)))}
              locked={editor.publishing}
            />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={editor.publishing} onClick={() => editor.setAdding(true)}>
              <PlusIcon />
              Add question
            </Button>
          </div>
        </section>
      </div>

      <AddFromBankDialog
        open={editor.adding}
        onOpenChange={editor.setAdding}
        draft={draft}
        onAdd={(question) => {
          editor.change(addItem(question));
          editor.setAdding(false);
        }}
      />
      <QuestionEditorDialog {...editor.questionEditor.dialogProps} />
    </>
  );
}

function ScreenHeader({ summary, summaryPending, children }: { summary: QuestionnaireSummary | undefined; summaryPending: boolean; children: ReactNode }) {
  return (
    <>
      <header className="flex items-center gap-2.5">
        <BackToQuestionnaires />
        <DraftHeading summary={summary} summaryPending={summaryPending} />
      </header>
      {children}
    </>
  );
}

export function DraftEditorScreen() {
  const { questionnaireId } = route.useParams();
  const draft = useQuery(questionnaireQueries.draft(questionnaireId));
  const { summary, isPending: summaryPending } = useQuestionnaireSummary(questionnaireId);

  if (draft.isSuccess) {
    return <DraftEditor questionnaireId={questionnaireId} draft={draft.data.draft} summary={summary} summaryPending={summaryPending} />;
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
    <ScreenHeader summary={summary} summaryPending={summaryPending}>
      {body}
    </ScreenHeader>
  );
}
