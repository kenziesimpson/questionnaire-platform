import type { BrowserContext, Page } from "@playwright/test";
import { RespondentPage, type OpenSecondContext, type SecondContextOptions } from "../../../fixtures/index";

export interface RespondentBrowser {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly respondent: RespondentPage;
}

export async function openRespondentBrowser(
  openContext: OpenSecondContext,
  storageState?: SecondContextOptions["storageState"],
): Promise<RespondentBrowser> {
  const context = await openContext({ storageState });
  const page = await context.newPage();
  return { context, page, respondent: new RespondentPage(page) };
}

export class MainFrameNavigations {
  readonly urls: string[] = [];

  watch(page: Page): void {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.urls.push(frame.url());
    });
  }
}
