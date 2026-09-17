import type { Page } from "@playwright/test";

export interface ConsoleError {
  readonly text: string;
  readonly url: string;
  readonly pageUrl: string;
}

const FAILED_RESOURCE_LOAD = /^Failed to load resource: /;

export class BrowserErrors {
  readonly consoleErrors: ConsoleError[] = [];
  readonly pageErrors: Error[] = [];
  private readonly watched = new WeakSet<Page>();

  watch(page: Page): void {
    if (this.watched.has(page)) return;
    this.watched.add(page);
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      this.consoleErrors.push({ text: message.text(), url: message.location().url, pageUrl: page.url() });
    });
    page.on("pageerror", (error) => {
      this.pageErrors.push(error);
    });
  }

  consoleErrorsExceptFailedResourceLoads(): ConsoleError[] {
    return this.consoleErrors.filter((entry) => !FAILED_RESOURCE_LOAD.test(entry.text));
  }

  summary(): { consoleErrors: string[]; pageErrors: string[] } {
    return {
      consoleErrors: this.consoleErrors.map((entry) => `${entry.text} (${entry.url || entry.pageUrl})`),
      pageErrors: this.pageErrors.map((error) => `${error.name}: ${error.message}`),
    };
  }
}
