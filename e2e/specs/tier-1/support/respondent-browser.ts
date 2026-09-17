import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";
import { definitionApi, executionApi } from "@qp/shared";
import { RespondentPage } from "../../../fixtures/index.ts";

export interface RespondentBrowser {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly respondent: RespondentPage;
}

export async function openRespondentBrowser(
  browser: Browser,
  baseUrl: string,
  storageState?: BrowserContextOptions["storageState"],
): Promise<RespondentBrowser> {
  const context = await browser.newContext({ baseURL: baseUrl, storageState, reducedMotion: "reduce" });
  const page = await context.newPage();
  return { context, page, respondent: new RespondentPage(page) };
}

export interface ObservedApiRequest {
  readonly method: string;
  readonly path: string;
}

export class ApiTraffic {
  readonly requests: ObservedApiRequest[] = [];

  watch(context: BrowserContext): void {
    context.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith("/api/")) this.requests.push({ method: request.method(), path: pathname });
    });
  }

  sessionCreations(): ObservedApiRequest[] {
    const path = `${executionApi.EXECUTION_PREFIX}${executionApi.createSession.url}`;
    return this.requests.filter((request) => request.method === executionApi.createSession.method && request.path === path);
  }

  sessionReads(sessionId: string): ObservedApiRequest[] {
    const path = `${executionApi.EXECUTION_PREFIX}${executionApi.getSession.url.replace(":sessionId", sessionId)}`;
    return this.requests.filter((request) => request.method === executionApi.getSession.method && request.path === path);
  }

  submissions(sessionId: string): ObservedApiRequest[] {
    const path = `${executionApi.EXECUTION_PREFIX}${executionApi.submitSession.url.replace(":sessionId", sessionId)}`;
    return this.requests.filter((request) => request.method === executionApi.submitSession.method && request.path === path);
  }

  definitionRequests(): ObservedApiRequest[] {
    return this.requests.filter((request) => request.path.startsWith(`${definitionApi.DEFINITION_PREFIX}/`));
  }

  clear(): void {
    this.requests.length = 0;
  }
}

export class MainFrameNavigations {
  readonly urls: string[] = [];

  watch(page: Page): void {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.urls.push(frame.url());
    });
  }
}
