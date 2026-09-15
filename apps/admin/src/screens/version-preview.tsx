import { Button } from "@qp/ui/primitives/button";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { isProblem } from "../api/problem-error";
import { questionnaireQueries } from "../api/queries";
import { ArrowLeftIcon } from "../components/icons";
import { VersionPreview } from "./version-preview/version-preview";

const route = getRouteApi("/questionnaires/$questionnaireId/versions/$version");

const publishedDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

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
        aria-label="Back to version history"
        title="Back to version history"
      >
        <ArrowLeftIcon />
      </Link>
    </Button>
  );
}

function PreviewHeader({ questionnaireId, version, title }: VersionAddress & { title: string | undefined }) {
  const publishedAt = usePublishedAt({ questionnaireId, version });
  const facts = [title, publishedAt && `published ${publishedDateFormat.format(new Date(publishedAt))}`].filter(Boolean);
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <BackToVersionHistory questionnaireId={questionnaireId} />
        <h1 className="text-xl font-semibold tracking-tight">Preview of version {version}</h1>
      </div>
      {facts.length > 0 && <p className="pl-9 text-sm text-muted-foreground">{facts.join(" · ")}</p>}
    </header>
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
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 p-6">
      <h2 className="text-base font-semibold">Version {version} could not be loaded</h2>
      <p className="text-sm text-muted-foreground">Something went wrong reaching the server. Try again.</p>
      <Button variant="outline" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}

export function VersionPreviewScreen() {
  const { questionnaireId, version } = route.useParams();
  const snapshot = useQuery(questionnaireQueries.version(questionnaireId, version));

  function body() {
    if (snapshot.isSuccess) {
      return <VersionPreview key={`${questionnaireId}:${version}`} definition={snapshot.data} />;
    }
    if (snapshot.isPending) {
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Loading version {version}…
        </p>
      );
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
