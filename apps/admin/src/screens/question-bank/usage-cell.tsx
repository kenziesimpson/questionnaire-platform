import type { Question } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { questionnaireQueries, questionQueries } from "../../api/queries";
import { groupUsage, type QuestionnaireUsage } from "./bank-display";

function questionnaireLabel(usage: QuestionnaireUsage): string {
  return usage.name ?? `Questionnaire ${usage.questionnaireId.slice(-8)}`;
}

function UsageLine({ usage }: { usage: QuestionnaireUsage }) {
  const label = questionnaireLabel(usage);
  return (
    <li className="grid grid-cols-[minmax(0,max-content)_auto] items-baseline justify-start gap-x-2">
      <span className="line-clamp-2 break-words" title={label}>
        {label}
      </span>
      <span className="flex max-w-32 flex-wrap gap-x-1 whitespace-nowrap">
        {usage.placements.map(({ version, questionVersion }, index) => (
          <span key={version}>
            <Link
              to="/questionnaires/$questionnaireId/versions/$version"
              params={{ questionnaireId: usage.questionnaireId, version }}
              aria-label={`Preview ${label} v${version}, which uses question v${questionVersion}`}
              title={`Uses question v${questionVersion}`}
              className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              v{version}
            </Link>
            {index < usage.placements.length - 1 ? "," : null}
          </span>
        ))}
      </span>
    </li>
  );
}

export function UsageCell({ question }: { question: Question }) {
  const usage = useQuery(questionQueries.usage(question.questionId));
  const questionnaires = useQuery(questionnaireQueries.list());

  if (usage.data === undefined && usage.isError) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        Usage not loaded
        <Button
          variant="ghost"
          size="xs"
          disabled={usage.isFetching}
          onClick={() => void usage.refetch()}
          aria-label={`Retry loading usage of ${question.latest.prompt}`}
        >
          Retry
        </Button>
      </span>
    );
  }
  if (usage.data === undefined) {
    return <span className="text-muted-foreground">Loading…</span>;
  }
  if (usage.data.length === 0) {
    return <span className="text-muted-foreground">Not in any published version</span>;
  }
  return (
    <ul aria-label={`Published versions using ${question.latest.prompt}`} className="flex w-72 flex-col gap-1.5 text-muted-foreground">
      {groupUsage(usage.data, questionnaires.data).map((group) => (
        <UsageLine key={group.questionnaireId} usage={group} />
      ))}
    </ul>
  );
}
