import type { QuestionInput } from "@qp/shared";
import { expect, test, uniqueName, type DefinitionApi } from "../../fixtures/index.ts";
import { ERROR_SUMMARY_TITLES, ITEM_ERROR_MESSAGES } from "./support/respondent-messages.ts";
import { recordSubmitRequests, submitBodyOf, waitForSubmitResponse } from "./support/submit-traffic.ts";

const NOTES = {
  itemId: "itm_notes",
  question: { type: "text", prompt: "Anything else we should know?", multiline: true, maxLength: 40 },
} as const satisfies { itemId: string; question: QuestionInput };

const CONTACT = {
  itemId: "itm_contact",
  question: {
    type: "single_choice",
    prompt: "How should we contact you?",
    options: [
      { optionId: "phone", label: "Phone" },
      { optionId: "email", label: "Email" },
    ],
  },
} as const satisfies { itemId: string; question: QuestionInput };

const SYMPTOMS = {
  itemId: "itm_symptoms",
  question: {
    type: "multiple_choice",
    prompt: "Which symptoms do you have?",
    minSelections: 2,
    maxSelections: 3,
    options: [
      { optionId: "headache", label: "Headache" },
      { optionId: "fever", label: "Fever" },
      { optionId: "cough", label: "Cough" },
      { optionId: "fatigue", label: "Fatigue" },
    ],
  },
} as const satisfies { itemId: string; question: QuestionInput };

const WEIGHT = {
  itemId: "itm_weight",
  question: { type: "number", prompt: "Body weight", numberKind: "integer", min: 20, max: 300, unit: "kg" },
} as const satisfies { itemId: string; question: QuestionInput };

const LAST_VISIT = {
  itemId: "itm_last_visit",
  question: { type: "date", prompt: "Date of your last visit", min: "2000-01-01", max: "2025-12-31" },
} as const satisfies { itemId: string; question: QuestionInput };

const FIXTURE_ITEMS = [NOTES, CONTACT, SYMPTOMS, WEIGHT, LAST_VISIT] as const;

async function publishAllTypesQuestionnaire(api: DefinitionApi): Promise<string> {
  const questions = await Promise.all(FIXTURE_ITEMS.map(({ question }) => api.createQuestion(question)));
  const placements = FIXTURE_ITEMS.map(({ itemId }, index) => {
    const question = questions[index];
    if (question === undefined) throw new Error(`No bank question was created for ${itemId}`);
    return { itemId, question, required: true };
  });
  const published = await api.createPublishedQuestionnaire({ name: uniqueName("E2E all response types"), title: "All response types" }, placements);
  return published.questionnaire.questionnaireId;
}

function inWeightUnit(amount: number): string {
  return `${amount} ${WEIGHT.question.unit}`;
}

function followedByUnitHint(message: string): string {
  return `${message} ${WEIGHT.question.unit}`;
}

test.describe("E18 — all five response types render, validate and submit", () => {
  test("each control renders, each client-side rule blocks the submit, and a valid submit stores canonical values", async ({
    page,
    api,
    respondent,
    db,
  }) => {
    const questionnaireId = await publishAllTypesQuestionnaire(api);
    const submitRequests = recordSubmitRequests(page);
    await respondent.openForm(questionnaireId);
    const { sessionId } = await respondent.waitForEnvelope(questionnaireId);

    const notes = page.getByRole("textbox", { name: NOTES.question.prompt });
    const contact = respondent.choiceGroup(CONTACT.question.prompt);
    const symptoms = respondent.checkboxGroup(SYMPTOMS.question.prompt);
    const weight = page.getByRole("textbox", { name: WEIGHT.question.prompt });
    const lastVisit = page.getByLabel(LAST_VISIT.question.prompt);
    const summary = respondent.errorSummary();

    await expect(notes).toHaveJSProperty("tagName", "TEXTAREA");
    await expect(contact.getByRole("radio")).toHaveCount(CONTACT.question.options.length);
    await expect(symptoms.getByRole("checkbox")).toHaveCount(SYMPTOMS.question.options.length);
    await expect(weight).toHaveAttribute("inputmode", "numeric");
    await expect(weight).toHaveAccessibleDescription(WEIGHT.question.unit);
    await expect(lastVisit).toHaveAttribute("type", "date");
    await expect(lastVisit).toHaveAttribute("min", LAST_VISIT.question.min);
    await expect(lastVisit).toHaveAttribute("max", LAST_VISIT.question.max);

    await respondent.submit();
    await expect(summary.getByRole("heading", { level: 2, name: ERROR_SUMMARY_TITLES.answers(FIXTURE_ITEMS.length) })).toBeVisible();
    await expect(summary.getByRole("listitem")).toHaveText(
      FIXTURE_ITEMS.map(({ question }) => `${question.prompt} — ${ITEM_ERROR_MESSAGES.required}`),
    );
    await expect(notes).toBeFocused();

    await respondent.fillText(NOTES.question.prompt, "x".repeat(NOTES.question.maxLength + 1));
    await respondent.choose(CONTACT.question.prompt, "Phone");
    await respondent.toggleCheckbox(SYMPTOMS.question.prompt, "Headache", true);
    await respondent.fillNumber(WEIGHT.question.prompt, "72.5");
    await respondent.fillDate(LAST_VISIT.question.prompt, "1999-12-31");

    await respondent.submit();
    await expect(summary.getByRole("heading", { level: 2, name: ERROR_SUMMARY_TITLES.answers(4) })).toBeVisible();
    await expect(notes).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.textTooLong(NOTES.question.maxLength));
    await expect(contact).not.toHaveAttribute("aria-invalid", "true");
    await expect(symptoms).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.tooFewChoices(SYMPTOMS.question.minSelections));
    await expect(weight).toHaveAccessibleDescription(followedByUnitHint(ITEM_ERROR_MESSAGES.notWholeNumber));
    await expect(lastVisit).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.dateBetween(LAST_VISIT.question.min, LAST_VISIT.question.max));

    for (const option of SYMPTOMS.question.options) await respondent.toggleCheckbox(SYMPTOMS.question.prompt, option.label, true);
    await respondent.fillNumber(WEIGHT.question.prompt, "301");
    await respondent.submit();
    await expect(symptoms).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.tooManyChoices(SYMPTOMS.question.maxSelections));
    await expect(weight).toHaveAccessibleDescription(followedByUnitHint(ITEM_ERROR_MESSAGES.numberBetween(inWeightUnit(WEIGHT.question.min), inWeightUnit(WEIGHT.question.max))));
    expect(submitRequests).toHaveLength(0);

    await respondent.fillText(NOTES.question.prompt, "Allergic to penicillin");
    await respondent.toggleCheckbox(SYMPTOMS.question.prompt, "Cough", false);
    await respondent.toggleCheckbox(SYMPTOMS.question.prompt, "Fatigue", false);
    await respondent.fillNumber(WEIGHT.question.prompt, "72.0");
    await respondent.fillDate(LAST_VISIT.question.prompt, "2024-02-29");
    await expect(summary).toHaveCount(0);

    const accepted = waitForSubmitResponse(page);
    await respondent.submit();
    const response = await accepted;
    expect(response.status()).toBe(200);
    expect(submitBodyOf(response.request()).answers).toEqual({
      [NOTES.itemId]: { type: "text", text: "Allergic to penicillin" },
      [CONTACT.itemId]: { type: "single_choice", optionId: "phone" },
      [SYMPTOMS.itemId]: { type: "multiple_choice", optionIds: ["headache", "fever"] },
      [WEIGHT.itemId]: { type: "number", value: "72.0" },
      [LAST_VISIT.itemId]: { type: "date", date: "2024-02-29" },
    });
    expect((await respondent.expectReceipt()).sessionId).toBe(sessionId);
    expect(submitRequests).toHaveLength(1);

    const rows = await db.responsesFor(sessionId);
    const rowFor = (itemId: string) => rows.find((row) => row.itemId === itemId);
    expect(rows).toHaveLength(FIXTURE_ITEMS.length);
    expect(rowFor(NOTES.itemId)).toMatchObject({ questionType: "text", textValue: "Allergic to penicillin" });
    expect(rowFor(CONTACT.itemId)).toMatchObject({ questionType: "single_choice", optionIds: ["phone"], otherText: null });
    expect(rowFor(SYMPTOMS.itemId)).toMatchObject({ questionType: "multiple_choice", optionIds: ["headache", "fever"] });
    expect(rowFor(WEIGHT.itemId)).toMatchObject({ questionType: "number", numberValue: "72", numberUnit: WEIGHT.question.unit });
    expect(rowFor(LAST_VISIT.itemId)).toMatchObject({ questionType: "date", dateValue: "2024-02-29" });
  });
});
