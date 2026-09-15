import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { DraftEditorScreen } from "./screens/draft-editor";
import { NotFoundScreen } from "./screens/not-found";
import { QuestionBankScreen } from "./screens/question-bank";
import { QuestionnaireListScreen } from "./screens/questionnaire-list";
import { VersionHistoryScreen } from "./screens/version-history";
import { VersionPreviewScreen } from "./screens/version-preview";
import { AppShell } from "./shell/app-shell";

export interface RouterContext {
  queryClient: QueryClient;
}

export const ROUTER_BASEPATH = "/admin";

function parseVersion(raw: string): number {
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1 || String(version) !== raw) {
    throw new Error(`"${raw}" is not a version number`);
  }
  return version;
}

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
  component: QuestionnaireListScreen,
});

const draftEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questionnaires/$questionnaireId/draft",
  component: DraftEditorScreen,
});

const versionHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questionnaires/$questionnaireId/versions",
  component: VersionHistoryScreen,
});

const versionPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questionnaires/$questionnaireId/versions/$version",
  params: {
    parse: ({ questionnaireId, version }) => ({ questionnaireId, version: parseVersion(version) }),
    stringify: ({ questionnaireId, version }) => ({ questionnaireId, version: String(version) }),
  },
  component: VersionPreviewScreen,
});

const questionBankRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questions",
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
