import { ArrowLeftIcon } from "@qp/ui/icons";
import { Alert, AlertDescription, AlertTitle } from "@qp/ui/primitives/alert";
import { Button } from "@qp/ui/primitives/button";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { isProblem } from "../api/problem-error";
import { questionnaireQueries } from "../api/queries";
import { LoadingLine } from "../components/query-state";
import { ScreenHeader } from "../components/screen-header";
import { calendarDateLabel } from "../lib/dates";
import { PreviewBody } from "./version-preview/preview-body";

const route = getRouteApi("/questionnaires/$questionnaireId/versions/$version");

interface VersionAddress {
  questionnaireId: string;
  version: number;
}

function usePublishedAt({ questionnaireId, version }: VersionAddress): string | undefined {
  const { data } = useQuery({
    ...questionnaireQueries.versions(questionnaireId),
    select: (versions) => versions.find((summary) => summary.version === version)?.publishedAt,
  });
  return data;
}

function BackToVersionHistory({ questionnaireId }: { questionnaireId: string }) {
  return (
    <Button asChild variant="ghost" size="icon-sm">
      <Link
        to="/questionnaires/$questionnaireId/versions"
        params={{ questionnaireId }}
        activeOptions={{ exact: true }}
        aria-label="Back to version history"
        title="Back to version history"
      >
        <ArrowLeftIcon size={18} aria-hidden="true" />
      </Link>
    </Button>
  );
}

function PreviewHeader({ questionnaireId, version, title }: VersionAddress & { title: string | undefined }) {
  const publishedAt = usePublishedAt({ questionnaireId, version });
  const facts = [title, publishedAt && `published ${calendarDateLabel(publishedAt)}`].filter(Boolean);
  return (
    <ScreenHeader
      back={<BackToVersionHistory questionnaireId={questionnaireId} />}
      title={`Preview of version ${version}`}
      meta={facts.length > 0 ? facts.join(" · ") : undefined}
    />
  );
}

function VersionNotFound({ version }: { version: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-6">
      <h2 className="text-base font-semibold">Version {version} is not published</h2>
      <p className="text-sm text-muted-foreground">
        This questionnaire has no published version {version}, or the questionnaire does not exist. A draft cannot be
        previewed here.
      </p>
    </div>
  );
}

function LoadFailed({ version, retrying, onRetry }: { version: number; retrying: boolean; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="flex-col items-start gap-3 rounded-xl p-6">
      <AlertTitle className="text-base">Version {version} could not be loaded</AlertTitle>
      <AlertDescription>Something went wrong reaching the server. Try again.</AlertDescription>
      <Button variant="outline" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </Alert>
  );
}

export function VersionPreviewScreen() {
  const { questionnaireId, version } = route.useParams();
  const snapshot = useQuery(questionnaireQueries.version(questionnaireId, version));

  function body() {
    if (snapshot.isSuccess) {
      return <PreviewBody key={`${questionnaireId}:${version}`} definition={snapshot.data} />;
    }
    if (snapshot.isPending) {
      return <LoadingLine>Loading version {version}…</LoadingLine>;
    }
    if (isProblem(snapshot.error, "resource/not-found")) {
      return <VersionNotFound version={version} />;
    }
    return <LoadFailed version={version} retrying={snapshot.isFetching} onRetry={() => void snapshot.refetch()} />;
  }

  return (
    <>
      <PreviewHeader questionnaireId={questionnaireId} version={version} title={snapshot.data?.title} />
      {body()}
    </>
  );
}
