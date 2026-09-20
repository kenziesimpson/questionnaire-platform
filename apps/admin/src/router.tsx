import { Uuid, type SessionSort, type SessionStatus, type SortOrder } from "@qp/shared";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { Value } from "typebox/value";
import { ErrorFallback } from "./components/error-fallback";
import { DraftEditorScreen } from "./screens/draft-editor";
import { NotFoundScreen } from "./screens/not-found";
import { QuestionBankScreen } from "./screens/question-bank";
import { QuestionnaireListScreen } from "./screens/questionnaire-list";
import { ResponseDetailScreen } from "./screens/response-detail";
import { ResponsesListScreen } from "./screens/responses-list";
import { VersionHistoryScreen } from "./screens/version-history";
import { VersionPreviewScreen } from "./screens/version-preview";
import { pageTitle } from "./page-title";
import { AppShell } from "./shell/app-shell";
import { reportRenderError } from "./telemetry/start";

export interface RouterContext {
  queryClient: QueryClient;
}

export const ROUTER_BASEPATH = "/admin";

function titled(page: string) {
  return { meta: [{ title: pageTitle(page) }] };
}

function parseUuid(raw: string): string {
  if (!Value.Check(Uuid, raw)) throw notFound();
  return raw;
}

const parseQuestionnaireId = parseUuid;

export interface ResponsesSearch {
  version?: number;
  status?: SessionStatus;
  sort?: Exclude<SessionSort, "started">;
  order?: Exclude<SortOrder, "desc">;
  cursor?: string;
}

function parseResponsesSearch(search: Record<string, unknown>): ResponsesSearch {
  const rawVersion = search.version;
  const version = typeof rawVersion === "string" || typeof rawVersion === "number" ? Number(rawVersion) : NaN;
  const status = search.status === "submitted" || search.status === "in_progress" ? search.status : undefined;
  const sort = search.sort === "submitted" ? search.sort : undefined;
  const order = search.order === "asc" ? search.order : undefined;
  const cursor = typeof search.cursor === "string" && search.cursor !== "" ? search.cursor : undefined;
  return { version: Number.isInteger(version) && version >= 1 ? version : undefined, status, sort, order, cursor };
}

function parseVersion(raw: string): number {
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1 || String(version) !== raw) throw notFound();
  return version;
}

const questionnaireParams = {
  parse: ({ questionnaireId }: { questionnaireId: string }) => ({ questionnaireId: parseQuestionnaireId(questionnaireId) }),
  stringify: ({ questionnaireId }: { questionnaireId: string }) => ({ questionnaireId }),
};

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
  notFoundComponent: NotFoundScreen,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/questionnaires", replace: true });
  },
});

const questionnaireListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questionnaires",
  head: () => titled("Questionnaires"),
  component: QuestionnaireListScreen,
});

const draftEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questionnaires/$questionnaireId/draft",
  params: questionnaireParams,
  head: () => titled("Draft editor"),
  component: DraftEditorScreen,
});

const versionHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questionnaires/$questionnaireId/versions",
  params: questionnaireParams,
  head: () => titled("Version history"),
  component: VersionHistoryScreen,
});

const versionPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questionnaires/$questionnaireId/versions/$version",
  params: {
    parse: ({ questionnaireId, version }) => ({
      questionnaireId: parseQuestionnaireId(questionnaireId),
      version: parseVersion(version),
    }),
    stringify: ({ questionnaireId, version }) => ({ questionnaireId, version: String(version) }),
  },
  head: ({ params }) => titled(`Preview of version ${params.version}`),
  component: VersionPreviewScreen,
});

const questionBankRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questions",
  head: () => titled("Question bank"),
  component: QuestionBankScreen,
});

const responsesListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questionnaires/$questionnaireId/responses",
  params: questionnaireParams,
  validateSearch: parseResponsesSearch,
  head: () => titled("Responses"),
  component: ResponsesListScreen,
});

const responseDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questionnaires/$questionnaireId/responses/$sessionId",
  params: {
    parse: ({ questionnaireId, sessionId }: { questionnaireId: string; sessionId: string }) => ({
      questionnaireId: parseUuid(questionnaireId),
      sessionId: parseUuid(sessionId),
    }),
    stringify: ({ questionnaireId, sessionId }: { questionnaireId: string; sessionId: string }) => ({ questionnaireId, sessionId }),
  },
  validateSearch: parseResponsesSearch,
  head: () => titled("Session detail"),
  component: ResponseDetailScreen,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  questionnaireListRoute,
  draftEditorRoute,
  versionHistoryRoute,
  versionPreviewRoute,
  questionBankRoute,
  responsesListRoute,
  responseDetailRoute,
]);

export function createAppRouter({ queryClient, history }: { queryClient: QueryClient; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    history,
    basepath: ROUTER_BASEPATH,
    context: { queryClient },
    defaultErrorComponent: ErrorFallback,
    defaultOnCatch: reportRenderError,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
