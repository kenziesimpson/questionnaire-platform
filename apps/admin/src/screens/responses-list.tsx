import type { SessionSort, SessionStatus, SessionSummary, VersionSummary } from "@qp/shared";
import { ArrowLeftIcon, ArrowRightIcon } from "@qp/ui/icons";
import { Button } from "@qp/ui/primitives/button";
import { NativeSelect } from "@qp/ui/primitives/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@qp/ui/primitives/table";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { isProblem } from "../api/problem-error";
import { questionnaireQueries, responseQueries } from "../api/queries";
import { BackToQuestionnaires } from "../components/back-to-questionnaires";
import { Panel } from "../components/panel";
import { Pill } from "../components/pill";
import { QuestionnaireNotFound } from "../components/questionnaire-not-found";
import { fullTimestamp } from "../lib/dates";
import type { ResponsesSearch } from "../router";
import { answeredSummary, shortSessionId, statusLabel } from "./responses-list/display";
import { SortHeader } from "./responses-list/sort-header";
import { nextSorting, sortDescription, sortingOf, sortSearch, type Sorting } from "./responses-list/sorting";

const route = getRouteApi("/questionnaires/$questionnaireId/responses");

const COLUMN_COUNT = 7;

function StatusPill({ status }: { status: SessionStatus }) {
  return <Pill className={status === "in_progress" ? "border-dashed text-muted-foreground" : ""}>{statusLabel(status)}</Pill>;
}

function Timestamp({ iso }: { iso: string | null }) {
  return iso === null ? <span>—</span> : <time dateTime={iso}>{fullTimestamp(iso)}</time>;
}

function ResponsesHeader({ questionnaireId, name }: { questionnaireId: string; name: string | undefined }) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackToQuestionnaires />
          <h1 className="text-xl font-semibold tracking-tight">Responses</h1>
        </div>
        <p className="pl-9 text-sm text-muted-foreground">{name ?? "Loading…"}</p>
      </div>
      <Button asChild variant="outline">
        <Link to="/questionnaires/$questionnaireId/versions" params={{ questionnaireId }}>
          Version history
        </Link>
      </Button>
    </header>
  );
}

interface Filters {
  version?: number;
  status?: SessionStatus;
}

function VersionFilter({
  versions,
  value,
  onChange,
}: {
  versions: VersionSummary[];
  value: number | undefined;
  onChange: (version: number | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="filter-version" className="text-sm font-medium">
        Version
      </label>
      <NativeSelect
        id="filter-version"
        className="w-34"
        value={value === undefined ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      >
        <option value="">All versions</option>
        {versions.map((summary) => (
          <option key={summary.version} value={summary.version}>
            Version {summary.version}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function StatusFilter({ value, onChange }: { value: SessionStatus | undefined; onChange: (status: SessionStatus | undefined) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="filter-status" className="text-sm font-medium">
        Status
      </label>
      <NativeSelect
        id="filter-status"
        className="w-34"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : (event.target.value as SessionStatus))}
      >
        <option value="">All statuses</option>
        <option value="submitted">Submitted</option>
        <option value="in_progress">In progress</option>
      </NativeSelect>
    </div>
  );
}

function SessionRow({ questionnaireId, session, search }: { questionnaireId: string; session: SessionSummary; search: ResponsesSearch }) {
  return (
    <TableRow>
      <TableCell>
        <span className="font-mono text-[13px]" title={session.sessionId}>
          {shortSessionId(session.sessionId)}
        </span>
      </TableCell>
      <TableCell>v{session.version}</TableCell>
      <TableCell>
        <StatusPill status={session.status} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        <Timestamp iso={session.startedAt} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        <Timestamp iso={session.submittedAt} />
      </TableCell>
      <TableCell className="text-muted-foreground">{answeredSummary(session)}</TableCell>
      <TableCell>
        <Button asChild variant="outline" size="sm">
          <Link
            to="/questionnaires/$questionnaireId/responses/$sessionId"
            params={{ questionnaireId, sessionId: session.sessionId }}
            search={search}
            aria-label={`Open session ${shortSessionId(session.sessionId)}`}
          >
            Open
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

type EmptyState = "loading" | "past-the-end" | "filtered" | "none";

function EmptyRow({ state, onFirstPage }: { state: EmptyState; onFirstPage: () => void }) {
  return (
    <TableRow>
      <TableCell colSpan={COLUMN_COUNT} className="py-6 text-center text-muted-foreground">
        {state === "loading" ? "Loading sessions…" : null}
        {state === "filtered" ? "No sessions match these filters." : null}
        {state === "none" ? "No sessions yet." : null}
        {state === "past-the-end" ? (
          <span className="flex flex-col items-center gap-3">
            <span>There are no sessions on this page. The list may have changed since it was opened.</span>
            <Button variant="outline" size="sm" onClick={onFirstPage}>
              Back to the first page
            </Button>
          </span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function emptyStateOf(search: ResponsesSearch, stale: boolean): EmptyState {
  if (stale) return "loading";
  if (search.cursor !== undefined) return "past-the-end";
  return search.version !== undefined || search.status !== undefined ? "filtered" : "none";
}

function SessionsTable({
  questionnaireId,
  items,
  search,
  sorting,
  stale,
  onSort,
  onFirstPage,
}: {
  questionnaireId: string;
  items: SessionSummary[];
  search: ResponsesSearch;
  sorting: Sorting;
  stale: boolean;
  onSort: (column: SessionSort) => void;
  onFirstPage: () => void;
}) {
  return (
    <div
      aria-busy={stale ? true : undefined}
      className={`overflow-hidden rounded-xl border border-border ${stale ? "opacity-75" : ""}`}
    >
      <Table>
        <TableCaption className="sr-only">
          Sessions, {sortDescription(sorting)}, {items.length} on this page
        </TableCaption>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-38 px-4 text-xs text-muted-foreground">Session</TableHead>
            <TableHead className="w-20 px-4 text-xs text-muted-foreground">Version</TableHead>
            <TableHead className="w-30 px-4 text-xs text-muted-foreground">Status</TableHead>
            <SortHeader column="started" label="Started" current={sorting} onSort={onSort} className="w-44 px-4 text-xs text-muted-foreground" />
            <SortHeader
              column="submitted"
              label="Submitted"
              current={sorting}
              onSort={onSort}
              className="w-44 px-4 text-xs text-muted-foreground"
            />
            <TableHead className="px-4 text-xs text-muted-foreground">Answered</TableHead>
            <TableHead className="w-20 px-4 text-xs text-muted-foreground">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-4 [&_td]:py-3">
          {items.length === 0 ? (
            <EmptyRow state={emptyStateOf(search, stale)} onFirstPage={onFirstPage} />
          ) : (
            items.map((session) => (
              <SessionRow key={session.sessionId} questionnaireId={questionnaireId} session={session} search={search} />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function PageNav({
  itemCount,
  previousCursor,
  nextCursor,
  onNavigate,
}: {
  itemCount: number;
  previousCursor: string | null;
  nextCursor: string | null;
  onNavigate: (cursor: string | undefined) => void;
}) {
  return (
    <nav aria-label="Pages of sessions" className="flex items-center justify-between gap-4">
      <p className="text-xs text-muted-foreground">
        {itemCount} {itemCount === 1 ? "session" : "sessions"} on this page
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={previousCursor === null} onClick={() => onNavigate(previousCursor ?? undefined)}>
          <ArrowLeftIcon size={14} />
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={nextCursor === null} onClick={() => onNavigate(nextCursor ?? undefined)}>
          Next
          <ArrowRightIcon size={14} />
        </Button>
      </div>
    </nav>
  );
}

export function ResponsesListScreen() {
  const { questionnaireId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate({ from: route.id });

  const questionnaires = useQuery(questionnaireQueries.list());
  const versions = useQuery(questionnaireQueries.versions(questionnaireId));
  const page = useQuery(responseQueries.list(questionnaireId, search));

  const summary = questionnaires.data?.find((candidate) => candidate.questionnaireId === questionnaireId);
  const filters: Filters = { version: search.version, status: search.status };
  const sorting = sortingOf(search);
  const ordering = { sort: search.sort, order: search.order };

  const setFilters = (next: Filters) => {
    void navigate({ search: { ...next, ...ordering, cursor: undefined } });
  };
  const setSorting = (column: SessionSort) => {
    void navigate({ search: { ...filters, ...sortSearch(nextSorting(sorting, column)), cursor: undefined } });
  };
  const setCursor = (cursor: string | undefined) => {
    void navigate({ search: { ...filters, ...ordering, cursor } });
  };

  const body = (() => {
    if (page.isError && isProblem(page.error, "resource/not-found")) {
      return <QuestionnaireNotFound />;
    }
    if (page.isPending) {
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Loading sessions…
        </p>
      );
    }
    if (page.isError) {
      return (
        <Panel role="alert">
          <p className="font-medium">The sessions could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void page.refetch()}>
            Try again
          </Button>
        </Panel>
      );
    }
    return (
      <>
        <SessionsTable
          questionnaireId={questionnaireId}
          items={page.data.items}
          search={search}
          sorting={sorting}
          stale={page.isPlaceholderData}
          onSort={setSorting}
          onFirstPage={() => setCursor(undefined)}
        />
        <PageNav
          itemCount={page.data.items.length}
          previousCursor={page.data.previousCursor}
          nextCursor={page.data.nextCursor}
          onNavigate={setCursor}
        />
      </>
    );
  })();

  return (
    <section className="flex flex-col gap-5">
      <ResponsesHeader questionnaireId={questionnaireId} name={summary?.name} />
      <div className="flex items-center gap-5">
        <VersionFilter
          versions={versions.data ?? []}
          value={search.version}
          onChange={(version) => setFilters({ ...filters, version })}
        />
        <StatusFilter value={search.status} onChange={(status) => setFilters({ ...filters, status })} />
      </div>
      {body}
      <span aria-live="polite" className="sr-only">
        Sorted {sortDescription(sorting)}
      </span>
    </section>
  );
}
