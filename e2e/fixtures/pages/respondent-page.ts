import { expect, type Locator, type Page } from "@playwright/test";
import { Value } from "typebox/value";
import { respondentStorageKey, RespondentStorageEnvelope } from "./respondent-storage";

export const RESPONDENT_HEADINGS = {
  submitted: "Your answers were submitted",
  alreadySubmitted: "This form was already submitted",
  closed: "This questionnaire is closed",
  notFound: "Questionnaire not found",
  loadFailed: "The questionnaire could not be loaded",
  somethingWentWrong: "Something went wrong",
} as const;

export const RESPONDENT_BUTTONS = {
  submit: "Submit answers",
  submitting: "Submitting…",
  tryAgain: "Try again",
  startNewSession: "Start a new session",
} as const;

export interface RespondentReceipt {
  readonly sessionId: string;
  readonly questionnaire: string;
  readonly submittedAt: string;
}

export type StoredValue =
  | { readonly kind: "absent" }
  | { readonly kind: "envelope"; readonly envelope: RespondentStorageEnvelope }
  | { readonly kind: "unrecognised"; readonly raw: string };

export class RespondentPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  questionnairePath(questionnaireId: string): string {
    return `/q/${questionnaireId}`;
  }

  async goto(questionnaireId: string): Promise<void> {
    await this.page.goto(this.questionnairePath(questionnaireId));
  }

  async openForm(questionnaireId: string): Promise<void> {
    await this.goto(questionnaireId);
    await this.expectForm();
  }

  async expectForm(): Promise<void> {
    await expect(this.submitButton()).toBeVisible();
  }

  heading(name: string): Locator {
    return this.page.getByRole("heading", { level: 1, name, exact: true });
  }

  form(title: string): Locator {
    return this.page.getByRole("form", { name: title, exact: true });
  }

  submitButton(): Locator {
    return this.page.getByRole("button", { name: RESPONDENT_BUTTONS.submit, exact: true });
  }

  tryAgainButton(): Locator {
    return this.page.getByRole("button", { name: RESPONDENT_BUTTONS.tryAgain, exact: true });
  }

  question(prompt: string): Locator {
    return this.page.getByLabel(prompt);
  }

  choiceGroup(prompt: string): Locator {
    return this.page.getByRole("radiogroup", { name: prompt });
  }

  checkboxGroup(prompt: string): Locator {
    return this.page.getByRole("group", { name: prompt });
  }

  option(prompt: string, optionLabel: string): Locator {
    return this.choiceGroup(prompt).getByRole("radio", { name: optionLabel, exact: true });
  }

  checkbox(prompt: string, optionLabel: string): Locator {
    return this.checkboxGroup(prompt).getByRole("checkbox", { name: optionLabel, exact: true });
  }

  otherText(prompt: string, optionLabel: string = "Other"): Locator {
    return this.page
      .getByRole("radiogroup", { name: prompt })
      .or(this.checkboxGroup(prompt))
      .getByRole("textbox", { name: `${optionLabel}, please specify`, exact: true });
  }

  errorSummary(): Locator {
    return this.page
      .getByRole("region")
      .filter({ has: this.page.getByRole("heading", { level: 2, name: /answers? needs? attention|answers could not be submitted/ }) });
  }

  visibilityAnnouncement(): Locator {
    return this.page.locator('[role="status"][aria-live="polite"]');
  }

  async choose(prompt: string, optionLabel: string): Promise<void> {
    await this.option(prompt, optionLabel).check();
  }

  async toggleCheckbox(prompt: string, optionLabel: string, checked: boolean): Promise<void> {
    await this.checkbox(prompt, optionLabel).setChecked(checked);
  }

  async fillText(prompt: string, text: string): Promise<void> {
    await this.page.getByRole("textbox", { name: prompt }).fill(text);
  }

  async fillNumber(prompt: string, value: string): Promise<void> {
    await this.fillText(prompt, value);
  }

  async fillDate(prompt: string, isoDate: string): Promise<void> {
    await this.page.getByLabel(prompt).fill(isoDate);
  }

  async fillOtherText(prompt: string, text: string, optionLabel: string = "Other"): Promise<void> {
    await this.otherText(prompt, optionLabel).fill(text);
  }

  async submit(): Promise<void> {
    await this.submitButton().click();
  }

  async expectReceipt(heading: string = RESPONDENT_HEADINGS.submitted): Promise<RespondentReceipt> {
    await expect(this.heading(heading)).toBeVisible();
    return {
      sessionId: (await this.receiptValue("Reference").innerText()).trim(),
      questionnaire: (await this.receiptValue("Questionnaire").innerText()).trim(),
      submittedAt: (await this.receiptValue("Submitted").locator("time").getAttribute("datetime")) ?? "",
    };
  }

  async submitAndExpectReceipt(): Promise<RespondentReceipt> {
    await this.submit();
    return this.expectReceipt();
  }

  receiptValue(term: string): Locator {
    return this.page.getByRole("term").filter({ hasText: term }).locator("xpath=following-sibling::dd[1]");
  }

  async readStoredValue(questionnaireId: string): Promise<StoredValue> {
    const raw = await this.page.evaluate((key) => window.localStorage.getItem(key), respondentStorageKey(questionnaireId));
    if (raw === null) return { kind: "absent" };
    const parsed = parseJson(raw);
    return Value.Check(RespondentStorageEnvelope, parsed) ? { kind: "envelope", envelope: parsed } : { kind: "unrecognised", raw };
  }

  async readEnvelope(questionnaireId: string): Promise<RespondentStorageEnvelope> {
    const stored = await this.readStoredValue(questionnaireId);
    if (stored.kind !== "envelope") {
      throw new Error(`Expected a respondent envelope under ${respondentStorageKey(questionnaireId)}, found ${JSON.stringify(stored)}`);
    }
    return stored.envelope;
  }

  async waitForEnvelope(questionnaireId: string): Promise<RespondentStorageEnvelope> {
    await expect.poll(async () => (await this.readStoredValue(questionnaireId)).kind).toBe("envelope");
    return this.readEnvelope(questionnaireId);
  }

  async writeStoredValue(questionnaireId: string, value: RespondentStorageEnvelope | string): Promise<void> {
    await this.ensureOnAppOrigin();
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    await this.page.evaluate(([key, text]) => window.localStorage.setItem(key, text), [respondentStorageKey(questionnaireId), raw] as const);
  }

  async clearStoredValue(questionnaireId: string): Promise<void> {
    await this.ensureOnAppOrigin();
    await this.page.evaluate((key) => window.localStorage.removeItem(key), respondentStorageKey(questionnaireId));
  }

  private async ensureOnAppOrigin(): Promise<void> {
    if (this.page.url().startsWith("http")) return;
    await this.page.goto("/");
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
