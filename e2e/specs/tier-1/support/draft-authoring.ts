import { expect, type Locator, type Page } from "@playwright/test";
import { ADMIN_HEADINGS, AdminPage } from "../../../fixtures/index";

export type NewQuestionSpec =
  | { readonly kind: "yesNo"; readonly prompt: string }
  | { readonly kind: "singleChoice"; readonly prompt: string; readonly optionLabels: readonly string[]; readonly allowOther: boolean }
  | { readonly kind: "date"; readonly prompt: string; readonly relativeToToday: "Any" | "Not in the future" | "Not in the past" }
  | { readonly kind: "text"; readonly prompt: string; readonly maxLength?: number };

const RESPONSE_TYPE_SEGMENT: Record<NewQuestionSpec["kind"], string> = {
  yesNo: "Single choice",
  singleChoice: "Single choice",
  date: "Date",
  text: "Text",
};

const DRAFT_EDITOR_PATH = /\/admin\/questionnaires\/([0-9a-f-]{36})\/draft$/;

export class DraftAuthoring {
  readonly page: Page;
  readonly admin: AdminPage;

  constructor(page: Page) {
    this.page = page;
    this.admin = new AdminPage(page);
  }

  async createQuestionnaire(name: string, title: string): Promise<string> {
    await this.admin.openQuestionnaires();
    await this.page.getByRole("button", { name: "New questionnaire", exact: true }).click();
    const dialog = this.page.getByRole("dialog", { name: "New questionnaire" });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await dialog.getByRole("textbox", { name: "Title", exact: true }).fill(title);
    await dialog.getByRole("button", { name: "Create questionnaire", exact: true }).click();
    await expect(this.page).toHaveURL(DRAFT_EDITOR_PATH);
    await expect(this.admin.publishButton()).toBeVisible();
    const questionnaireId = DRAFT_EDITOR_PATH.exec(new URL(this.page.url()).pathname)?.[1];
    if (questionnaireId === undefined) throw new Error(`Creating a questionnaire landed on ${this.page.url()}, not its draft editor`);
    return questionnaireId;
  }

  draftItems(): Locator {
    return this.admin.draftItemList();
  }

  draftItem(position: number): Locator {
    return this.draftItems().getByRole("listitem", { name: new RegExp(`^Question ${position},`) });
  }

  saveStatus(): Locator {
    return this.page.getByRole("status").filter({ hasText: /^(Saving…|All changes saved)$/ });
  }

  async addNewQuestion(spec: NewQuestionSpec): Promise<void> {
    const positionAfterAdding = (await this.draftItems().getByRole("listitem").count()) + 1;
    await this.admin.addQuestionButton().click();
    const bankDialog = this.page.getByRole("dialog", { name: "Add a question" });
    await bankDialog.getByRole("button", { name: "New question", exact: true }).click();
    const editor = this.page.getByRole("dialog", { name: "New question" });
    await this.fillQuestionEditor(editor, spec);
    await editor.getByRole("button", { name: "Save as version 1", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(bankDialog).toHaveCount(0);
    await expect(this.draftItem(positionAfterAdding)).toContainText(spec.prompt);
  }

  async relabelOption(position: number, optionId: string, label: string, savedVersion: number): Promise<void> {
    await this.page.getByRole("button", { name: `Edit question ${position}`, exact: true }).click();
    const editor = this.page.getByRole("dialog", { name: "Edit question" });
    await editor.getByRole("textbox", { name: `Label for ${optionId}`, exact: true }).fill(label);
    await editor.getByRole("button", { name: `Save as version ${savedVersion}`, exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(this.draftItem(position)).toContainText(`pinned v${savedVersion}`);
  }

  async showOnlyWhen(position: number, condition: { readonly position: number; readonly prompt: string; readonly optionLabel: string }): Promise<void> {
    await this.page.getByRole("button", { name: `Rules for question ${position}`, exact: true }).click();
    const rules = this.page.getByRole("group", { name: `Rules for question ${position}`, exact: true });
    await rules.getByRole("button", { name: "Add condition", exact: true }).click();
    const question = rules.getByRole("combobox", { name: "Condition 1: question", exact: true });
    await question.selectOption({ label: `${condition.position}. ${condition.prompt}` });
    await expect(rules.getByRole("combobox", { name: "Condition 1: operator", exact: true })).toHaveValue("is");
    await rules.getByRole("combobox", { name: "Condition 1: value", exact: true }).selectOption({ label: condition.optionLabel });
    await expect(this.draftItem(position)).toContainText("Shown when 1 condition is true");
  }

  async publish(expectedVersion: number): Promise<void> {
    await expect(this.saveStatus()).toHaveText("All changes saved");
    await expect(this.admin.publishButton()).toBeEnabled();
    await this.admin.publishButton().click();
    await expect(this.admin.heading(ADMIN_HEADINGS.versionHistory)).toBeVisible();
    await expect(this.page.getByRole("cell", { name: `Version ${expectedVersion}`, exact: true })).toBeVisible();
  }

  private async fillQuestionEditor(editor: Locator, spec: NewQuestionSpec): Promise<void> {
    await this.chooseSegment(editor, "Response type", RESPONSE_TYPE_SEGMENT[spec.kind]);
    if (spec.kind === "yesNo") await editor.getByRole("checkbox", { name: "Yes / No question", exact: true }).check();
    await editor.getByRole("textbox", { name: "Prompt", exact: true }).fill(spec.prompt);
    switch (spec.kind) {
      case "yesNo":
        return;
      case "singleChoice":
        return this.fillOptions(editor, spec.optionLabels, spec.allowOther);
      case "date":
        await this.chooseSegment(editor, "Relative to today", spec.relativeToToday);
        return;
      case "text":
        if (spec.maxLength !== undefined) await editor.getByRole("textbox", { name: "Max length", exact: true }).fill(String(spec.maxLength));
        return;
    }
  }

  private async chooseSegment(editor: Locator, legend: string, segment: string): Promise<void> {
    const group = editor.getByRole("group", { name: legend });
    await group.getByText(segment, { exact: true }).click();
    await expect(group.getByRole("radio", { name: segment, exact: true })).toBeChecked();
  }

  private async fillOptions(editor: Locator, optionLabels: readonly string[], allowOther: boolean): Promise<void> {
    const labels = editor.getByRole("list", { name: "Options, in order" }).getByRole("textbox");
    for (const [index, label] of optionLabels.entries()) {
      if (index > 0) {
        await editor.getByRole("button", { name: "Add option", exact: true }).click();
        await expect(labels).toHaveCount(index + 1);
      }
      await labels.nth(index).fill(label);
    }
    if (allowOther) await editor.getByRole("checkbox", { name: "Allow a freeform “Other” option", exact: true }).check();
  }
}
