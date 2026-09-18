import type { QuestionnaireSummary } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Link } from "@tanstack/react-router";
import { useOpenDraft } from "../../api/mutations/use-open-draft";
import { useQuestionnaireSummary } from "../../api/use-questionnaire-summary";
import { Notice } from "../../components/notice";
import { QuestionnaireNotFound } from "../../components/questionnaire-not-found";

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

export function MissingDraft({ questionnaireId }: { questionnaireId: string }) {
  const { summary, isPending } = useQuestionnaireSummary(questionnaireId);
  if (isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading draft…
      </p>
    );
  }
  if (summary === undefined) {
    return <QuestionnaireNotFound />;
  }
  return <NoOpenDraft questionnaireId={questionnaireId} summary={summary} />;
}
