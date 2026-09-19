import type { SessionDetail, SessionDetailItem } from "@qp/shared";
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon } from "@qp/ui/icons";
import { Button } from "@qp/ui/primitives/button";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { isProblem } from "../api/problem-error";
import { questionnaireQueries, responseQueries } from "../api/queries";
import { Panel } from "../components/panel";
import { Pill } from "../components/pill";
import { fullTimestamp } from "../lib/dates";
import { AnswerDisplay, questionTypeLabel, visibilityRuleLabel } from "./response-detail/answer-display";
import { shortSessionId, statusLabel } from "./responses-list/display";

const route = getRouteApi("/questionnaires/$questionnaireId/responses/$sessionId");

function BackToResponses({ questionnaireId, search }: { questionnaireId: string; search: ReturnType<typeof route.useSearch> }) {
  return (
    <Button asChild variant="ghost" size="icon-sm">
      <Link
        to="/questionnaires/$questionnaireId/responses"
        params={{ questionnaireId }}
        search={search}
        aria-label="Back to responses"
        title="Back to responses"
      >
        <ArrowLeftIcon />
      </Link>
    </Button>
  );
}

interface PageContext {
  readonly index: number;
  readonly count: number;
  readonly newerSessionId: string | undefined;
  readonly olderSessionId: string | undefined;
}

function usePageContext(questionnaireId: string, sessionId: string, search: ReturnType<typeof route.useSearch>): PageContext | undefined {
  const { data } = useQuery(responseQueries.list(questionnaireId, search));
  if (data === undefined) return undefined;
  const index = data.items.findIndex((item) => item.sessionId === sessionId);
  return {
    index,
    count: data.items.length,
    newerSessionId: index > 0 ? data.items[index - 1]?.sessionId : undefined,
    olderSessionId: index >= 0 && index < data.items.length - 1 ? data.items[index + 1]?.sessionId : undefined,
  };
}

function NeighborButton({
  questionnaireId,
  sessionId,
  search,
  children,
}: {
  questionnaireId: string;
  sessionId: string | undefined;
  search: ReturnType<typeof route.useSearch>;
  children: ReactNode;
}) {
  if (sessionId === undefined) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/questionnaires/$questionnaireId/responses/$sessionId" params={{ questionnaireId, sessionId }} search={search}>
        {children}
      </Link>
    </Button>
  );
}

function SessionNav({
  questionnaireId,
  search,
  context,
}: {
  questionnaireId: string;
  search: ReturnType<typeof route.useSearch>;
  context: PageContext | undefined;
}) {
  return (
    <div className="flex items-center gap-2">
      {context !== undefined && context.index >= 0 ? (
        <span className="text-xs text-muted-foreground">
          {context.index + 1} of {context.count} on this page
        </span>
      ) : null}
      <NeighborButton questionnaireId={questionnaireId} sessionId={context?.newerSessionId} search={search}>
        <ArrowLeftIcon size={14} />
        Newer session
      </NeighborButton>
      <NeighborButton questionnaireId={questionnaireId} sessionId={context?.olderSessionId} search={search}>
        Older session
        <ArrowRightIcon size={14} />
      </NeighborButton>
    </div>
  );
}

function DetailHeader({
  questionnaireId,
  detail,
  search,
  context,
}: {
  questionnaireId: string;
  detail: SessionDetail;
  search: ReturnType<typeof route.useSearch>;
  context: PageContext | undefined;
}) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackToResponses questionnaireId={questionnaireId} search={search} />
          <h1 className="text-xl font-semibold tracking-tight">
            Session <span className="font-mono text-lg font-medium">{shortSessionId(detail.sessionId)}</span>
          </h1>
          <Pill className={detail.status === "in_progress" ? "border-dashed text-muted-foreground" : ""}>
            {statusLabel(detail.status)}
          </Pill>
        </div>
        <p className="pl-9 text-sm text-muted-foreground">
          {detail.questionnaireTitle} · version {detail.version}
        </p>
      </div>
      <SessionNav questionnaireId={questionnaireId} search={search} context={context} />
    </header>
  );
}

function VersionPinNote({ questionnaireId, detail }: { questionnaireId: string; detail: SessionDetail }) {
  const { data: versions } = useQuery(questionnaireQueries.versions(questionnaireId));
  const latest = versions?.[0]?.version;
  if (latest === undefined || latest === detail.version) return null;
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-xl border border-border px-4 py-3 text-sm">
      <InfoIcon className="mt-0.5 shrink-0 text-muted-foreground" />
      <p>
        This session is pinned to version {detail.version}. The questionnaire has since moved to version {latest}.
      </p>
    </div>
  );
}

function InProgressNotice() {
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-xl border border-border px-4 py-4 text-sm">
      <InfoIcon className="shrink-0 text-muted-foreground" />
      <p className="font-medium">No answers are stored for this session yet</p>
    </div>
  );
}

function HiddenPill() {
  return <Pill className="border-dashed text-muted-foreground">Hidden by rules</Pill>;
}

function ItemRow({ item, inProgress, position }: { item: SessionDetailItem; inProgress: boolean; position: number }) {
  const hidden = !inProgress && !item.visible;
  return (
    <li className="flex gap-3 border-b border-border p-4 last:border-b-0">
      <span aria-hidden="true" className="w-4 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">
        {position}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="sr-only">Question {position},</span>
        <span className={hidden ? "font-medium text-muted-foreground" : "font-medium"}>{item.question.prompt}</span>
        <span className="text-xs text-muted-foreground">
          {questionTypeLabel(item.question.type)} · pinned v{item.question.questionVersion} ·{" "}
          {visibilityRuleLabel(item.visibleWhen)} · {item.required ? "Required" : "Optional"}
        </span>
        <div className="mt-2 flex flex-col gap-1">
          {inProgress ? (
            <span className="text-xs text-muted-foreground">Not stored until submit</span>
          ) : hidden ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2.5">
              <HiddenPill />
            </div>
          ) : item.answer === null ? (
            <span className="text-xs text-muted-foreground">Not answered</span>
          ) : (
            <AnswerDisplay question={item.question} answer={item.answer} />
          )}
        </div>
      </div>
    </li>
  );
}

function ItemList({ detail }: { detail: SessionDetail }) {
  const inProgress = detail.status === "in_progress";
  return (
    <ol className="flex flex-col rounded-xl border border-border">
      {detail.items.map((item, index) => (
        <ItemRow key={item.itemId} item={item} inProgress={inProgress} position={index + 1} />
      ))}
    </ol>
  );
}

function SessionPanel({ questionnaireId, detail }: { questionnaireId: string; detail: SessionDetail }) {
  const answeredCount = detail.items.filter((item) => item.answer !== null).length;
  return (
    <section aria-labelledby="session-panel-heading" className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <h2 id="session-panel-heading" className="text-sm font-semibold">
        Session
      </h2>
      <dl className="flex flex-col gap-2.5">
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3">
          <dt className="text-xs text-muted-foreground">Session id</dt>
          <dd className="font-mono text-[13px]">{shortSessionId(detail.sessionId)}</dd>
        </div>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3">
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd>
            <Pill className={detail.status === "in_progress" ? "border-dashed text-muted-foreground" : ""}>
              {statusLabel(detail.status)}
            </Pill>
          </dd>
        </div>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3">
          <dt className="text-xs text-muted-foreground">Version</dt>
          <dd>
            <Link
              className="hover:underline"
              to="/questionnaires/$questionnaireId/versions/$version"
              params={{ questionnaireId, version: detail.version }}
            >
              Version {detail.version}
            </Link>
          </dd>
        </div>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3">
          <dt className="text-xs text-muted-foreground">Started</dt>
          <dd>
            <time dateTime={detail.startedAt}>{fullTimestamp(detail.startedAt)}</time>
          </dd>
        </div>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3">
          <dt className="text-xs text-muted-foreground">Submitted</dt>
          <dd className={detail.submittedAt === null ? "text-muted-foreground" : undefined}>
            {detail.submittedAt === null ? "—" : <time dateTime={detail.submittedAt}>{fullTimestamp(detail.submittedAt)}</time>}
          </dd>
        </div>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3">
          <dt className="text-xs text-muted-foreground">Stored answers</dt>
          <dd className={detail.status === "in_progress" ? "text-muted-foreground" : undefined}>
            {detail.status === "in_progress" ? "None until submit" : `${answeredCount} of ${detail.items.length} questions`}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function SessionNotFound() {
  return (
    <Panel role="alert">
      <p className="font-medium">This session could not be found.</p>
      <p className="text-muted-foreground">It may belong to a different questionnaire, or the id is wrong.</p>
    </Panel>
  );
}

export function ResponseDetailScreen() {
  const { questionnaireId, sessionId } = route.useParams();
  const search = route.useSearch();
  const detailQuery = useQuery(responseQueries.session(questionnaireId, sessionId));
  const context = usePageContext(questionnaireId, sessionId, search);

  if (detailQuery.isError && isProblem(detailQuery.error, "resource/not-found")) {
    return (
      <section className="flex flex-col gap-5">
        <header className="flex items-center gap-2">
          <BackToResponses questionnaireId={questionnaireId} search={search} />
          <h1 className="text-xl font-semibold tracking-tight">Session not found</h1>
        </header>
        <SessionNotFound />
      </section>
    );
  }

  if (detailQuery.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading session…
      </p>
    );
  }

  if (detailQuery.isError) {
    return (
      <Panel role="alert">
        <p className="font-medium">This session could not be loaded.</p>
        <Button variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>
          Try again
        </Button>
      </Panel>
    );
  }

  const detail = detailQuery.data;
  return (
    <section className="flex flex-col gap-5">
      <DetailHeader questionnaireId={questionnaireId} detail={detail} search={search} context={context} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-3">
          <VersionPinNote questionnaireId={questionnaireId} detail={detail} />
          {detail.status === "in_progress" ? <InProgressNotice /> : null}
          <ItemList detail={detail} />
        </div>
        <SessionPanel questionnaireId={questionnaireId} detail={detail} />
      </div>
    </section>
  );
}
