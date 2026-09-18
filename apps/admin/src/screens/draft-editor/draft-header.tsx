import type { QuestionnaireSummary } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Link } from "@tanstack/react-router";
import { BackToQuestionnaires } from "../../components/back-to-questionnaires";
import type { PublishHint } from "./publish-checks";

export function publishFacts(summary: QuestionnaireSummary | undefined) {
  if (summary === undefined) return null;
  if (summary.currentVersion === null) return "never published · publishing creates version 1";
  return `published v${summary.currentVersion} · publishing creates v${summary.currentVersion + 1}`;
}

export function DraftHeading({ summary, summaryPending }: { summary: QuestionnaireSummary | undefined; summaryPending: boolean }) {
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

export function DraftEditorHeader({
  questionnaireId,
  summary,
  summaryPending,
  isSaving,
  publishing,
  publishHint,
  publishHintId,
  onFocusChecks,
  onPublish,
}: {
  questionnaireId: string;
  summary: QuestionnaireSummary | undefined;
  summaryPending: boolean;
  isSaving: boolean;
  publishing: boolean;
  publishHint: PublishHint | null;
  publishHintId: string;
  onFocusChecks: () => void;
  onPublish: () => void;
}) {
  return (
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
            {isSaving ? "Saving…" : "All changes saved"}
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
            onClick={onPublish}
          >
            {publishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>
      {publishHint !== null && (
        <p id={publishHintId} className="text-right text-xs text-muted-foreground">
          {publishHint.lead}
          {publishHint.linksToChecks && (
            <Button type="button" variant="link" className="h-auto p-0 text-xs text-foreground" onClick={onFocusChecks}>
              Publish checks
            </Button>
          )}
          {publishHint.trail}
        </p>
      )}
    </header>
  );
}
