import type { QuestionnaireSummary, VersionSummary } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@qp/ui/primitives/table";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { isProblem } from "../api/problem-error";
import { questionnaireQueries } from "../api/queries";
import { BackToQuestionnaires } from "../components/back-to-questionnaires";
import { questionCount } from "../components/counts";
import { Notice } from "../components/notice";

const route = getRouteApi("/questionnaires/$questionnaireId/versions");

const ABSENT = "—";

const COLUMN_COUNT = 5;

const timestampFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function Timestamp({ iso }: { iso: string }) {
  return <time dateTime={iso}>{timestampFormat.format(new Date(iso))}</time>;
}

function HistoryHeader({ name }: { name: string | undefined }) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <BackToQuestionnaires />
        <h1 className="text-xl font-semibold tracking-tight">Version history</h1>
      </div>
      {name === undefined ? null : <p className="pl-9 text-sm text-muted-foreground">{name}</p>}
    </header>
  );
}

function DraftRow({ questionnaireId, updatedAt }: { questionnaireId: string; updatedAt: string }) {
  return (
    <TableRow>
      <TableCell>
        <span className="inline-flex h-5 items-center rounded-full border border-border bg-muted px-2 text-xs font-medium">
          Draft
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">{ABSENT}</TableCell>
      <TableCell className="text-muted-foreground">
        Edited <Timestamp iso={updatedAt} />
      </TableCell>
      <TableCell className="text-muted-foreground">{ABSENT}</TableCell>
      <TableCell>
        <Button asChild variant="outline" size="sm">
          <Link to="/questionnaires/$questionnaireId/draft" params={{ questionnaireId }} aria-label="Edit the draft">
            Edit
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function VersionRow({ summary }: { summary: VersionSummary }) {
  return (
    <TableRow>
      <TableCell className="font-medium">Version {summary.version}</TableCell>
      <TableCell>{questionCount(summary.itemCount)}</TableCell>
      <TableCell className="text-muted-foreground">
        <Timestamp iso={summary.publishedAt} />
      </TableCell>
      <TableCell className="text-muted-foreground">{summary.publishedBy ?? ABSENT}</TableCell>
      <TableCell>
        <Button asChild variant="outline" size="sm">
          <Link
            to="/questionnaires/$questionnaireId/versions/$version"
            params={{ questionnaireId: summary.questionnaireId, version: summary.version }}
            aria-label={`Preview version ${summary.version}`}
          >
            Preview
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function NeverPublishedRow() {
  return (
    <TableRow>
      <TableCell colSpan={COLUMN_COUNT} className="py-6 text-center text-muted-foreground">
        Never published. Publishing the draft creates version 1.
      </TableCell>
    </TableRow>
  );
}

function VersionsTable({
  questionnaireId,
  versions,
  draft,
}: {
  questionnaireId: string;
  versions: VersionSummary[];
  draft: QuestionnaireSummary | undefined;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableCaption className="sr-only">Published versions, newest first, and the open draft</TableCaption>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-36 px-4 text-xs text-muted-foreground">Version</TableHead>
            <TableHead className="px-4 text-xs text-muted-foreground">Contents</TableHead>
            <TableHead className="w-56 px-4 text-xs text-muted-foreground">Published</TableHead>
            <TableHead className="w-40 px-4 text-xs text-muted-foreground">Published by</TableHead>
            <TableHead className="w-28 px-4 text-xs text-muted-foreground">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-4 [&_td]:py-3">
          {draft?.hasDraft === true ? <DraftRow questionnaireId={questionnaireId} updatedAt={draft.updatedAt} /> : null}
          {versions.length === 0 ? <NeverPublishedRow /> : versions.map((summary) => <VersionRow key={summary.version} summary={summary} />)}
        </TableBody>
      </Table>
    </div>
  );
}

function ImmutabilityNote() {
  return (
    <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
      A published version cannot be edited, only superseded. Sessions started against a version stay on it to the end, and
      responses keep the version they were collected under.
    </p>
  );
}

export function VersionHistoryScreen() {
  const { questionnaireId } = route.useParams();
  const versions = useQuery(questionnaireQueries.versions(questionnaireId));
  const questionnaires = useQuery(questionnaireQueries.list());
  const summary = questionnaires.data?.find((candidate) => candidate.questionnaireId === questionnaireId);

  const body = (() => {
    if (versions.isPending || questionnaires.isPending) {
      return <p role="status" className="text-sm text-muted-foreground">Loading versions…</p>;
    }
    if (versions.isError && isProblem(versions.error, "resource/not-found")) {
      return (
        <Notice>
          <p className="font-medium">This questionnaire does not exist.</p>
          <Link to="/questionnaires" className="font-medium underline underline-offset-4">
            Back to questionnaires
          </Link>
        </Notice>
      );
    }
    if (versions.isError) {
      return (
        <Notice>
          <p role="alert" className="font-medium">
            The version history could not be loaded.
          </p>
          <Button variant="outline" size="sm" onClick={() => void versions.refetch()}>
            Try again
          </Button>
        </Notice>
      );
    }
    return (
      <>
        <VersionsTable questionnaireId={questionnaireId} versions={versions.data} draft={summary} />
        <ImmutabilityNote />
      </>
    );
  })();

  return (
    <section className="flex flex-col gap-5">
      <HistoryHeader name={summary?.name} />
      {body}
    </section>
  );
}
