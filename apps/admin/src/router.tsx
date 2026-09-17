import { Uuid } from "@qp/shared";
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
import { DraftEditorScreen } from "./screens/draft-editor";
import { NotFoundScreen } from "./screens/not-found";
import { QuestionBankScreen } from "./screens/question-bank";
import { QuestionnaireListScreen } from "./screens/questionnaire-list";
import { VersionHistoryScreen } from "./screens/version-history";
import { VersionPreviewScreen } from "./screens/version-preview";
import { pageTitle } from "./page-title";
import { AppShell } from "./shell/app-shell";

export interface RouterContext {
  queryClient: QueryClient;
}

export const ROUTER_BASEPATH = "/admin";

function titled(page: string) {
  return { meta: [{ title: pageTitle(page) }] };
}

function parseQuestionnaireId(raw: string): string {
  if (!Value.Check(Uuid, raw)) throw notFound();
  return raw;
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

export const routeTree = rootRoute.addChildren([
  indexRoute,
  questionnaireListRoute,
  draftEditorRoute,
  versionHistoryRoute,
  versionPreviewRoute,
  questionBankRoute,
]);

export function createAppRouter({ queryClient, history }: { queryClient: QueryClient; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    history,
    basepath: ROUTER_BASEPATH,
    context: { queryClient },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
