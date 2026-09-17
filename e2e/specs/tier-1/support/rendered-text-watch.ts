import type { Page } from "@playwright/test";

const BINDING_NAME = "e2eRecordRenderedText";

const OBSERVER_SCRIPT = `
new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      const text = node.textContent;
      if (text) window.${BINDING_NAME}(text);
    }
  }
}).observe(document, { childList: true, subtree: true, characterData: true });
`;

export class RenderedTextWatch {
  readonly page: Page;
  private readonly texts: string[] = [];

  private constructor(page: Page) {
    this.page = page;
  }

  static async install(page: Page): Promise<RenderedTextWatch> {
    const watch = new RenderedTextWatch(page);
    await page.exposeFunction(BINDING_NAME, (text: string) => {
      watch.texts.push(text);
    });
    await page.addInitScript({ content: OBSERVER_SCRIPT });
    return watch;
  }

  async everRendered(text: string): Promise<boolean> {
    await this.page.evaluate(() => document.readyState);
    return this.texts.some((rendered) => rendered.includes(text));
  }
}
